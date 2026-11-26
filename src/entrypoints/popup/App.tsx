import { useEffect, useState } from 'react';
import { DEFAULT_FILTER_CONFIG } from '@/types/item';
import type { ExtensionMessage, PetStatus } from '@/types/messages';

function sendMsg<T>(msg: ExtensionMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

export default function App() {
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_FILTER_CONFIG.l2Threshold);

  useEffect(() => {
    void sendMsg<PetStatus>({ type: 'GET_STATUS' }).then((res) => {
      if (!res) return;
      setStatus(res);
      setThreshold(res.config.l2Threshold);
    });
  }, []);

  const handleThresholdChange = (value: number) => {
    setThreshold(value);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { l2Threshold: value } });
  };

  const backendLabel =
    status?.backend === 'webgpu'
      ? 'WebGPU 本地加速'
      : status?.backend === 'wasm'
        ? 'WASM 本地运行'
        : '轻装规则模式（模型加载中）';

  return (
    <div className="w-80 p-4 bg-slate-950 text-slate-100 space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🐾</span>
          <div>
            <h1 className="text-sm font-semibold">Attention Filter Pet</h1>
            <p className="text-xs text-slate-400">本地注意力守护宠物</p>
          </div>
        </div>
        <span
          className={`px-2 py-0.5 text-[11px] rounded-full border ${
            status?.modelReady
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          }`}
        >
          {backendLabel}
        </span>
      </header>

      <section className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
          <div className="text-lg font-bold text-sky-400">{status?.todayEaten ?? 0}</div>
          <div className="text-[11px] text-slate-400">今日吃掉</div>
        </div>
        <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
          <div className="text-lg font-bold text-rose-400">{status?.negativeCount ?? 0}</div>
          <div className="text-[11px] text-slate-400">负样本库</div>
        </div>
        <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800">
          <div className="text-lg font-bold text-emerald-400">{status?.positiveCount ?? 0}</div>
          <div className="text-[11px] text-slate-400">白库纠偏</div>
        </div>
      </section>

      <section className="rounded-lg bg-slate-900 p-3 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300">语义拦截阈值（越低越严格）</span>
          <span className="font-mono text-sky-400">{threshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.55}
          max={0.95}
          step={0.01}
          value={threshold}
          onChange={(e) => handleThresholdChange(Number(e.target.value))}
          className="w-full accent-sky-400"
        />
        <p className="text-[11px] text-slate-500">
          所有计算与向量均保存在本地 IndexedDB，无任何数据上传。
        </p>
      </section>
    </div>
  );
}
