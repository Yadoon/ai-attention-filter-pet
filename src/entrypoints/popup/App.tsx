import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FILTER_CONFIG } from '@/types/item';
import type {
  ExportDataResponse,
  ExtensionMessage,
  ImportDataResponse,
  PetDataBackup,
  PetStatus,
  SyncNowResponse,
} from '@/types/messages';
import { PET_SKINS, getPetSkin, type PetSkinId } from '@/ui/pet-skins';

function sendMsg<T>(msg: ExtensionMessage): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

export default function App() {
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_FILTER_CONFIG.l2Threshold);
  const [positiveAlpha, setPositiveAlpha] = useState(DEFAULT_FILTER_CONFIG.positiveAlpha);
  const [positiveMinSim, setPositiveMinSim] = useState(DEFAULT_FILTER_CONFIG.positiveMinSim);
  const [petSkin, setPetSkin] = useState<PetSkinId>(DEFAULT_FILTER_CONFIG.petSkin);
  const [syncNativeDislike, setSyncNativeDislike] = useState(
    DEFAULT_FILTER_CONFIG.syncNativeDislike,
  );
  const [ruleInput, setRuleInput] = useState('');
  const [backupMsg, setBackupMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadStatus = () => {
    void sendMsg<PetStatus>({ type: 'GET_STATUS' }).then((res) => {
      if (!res) return;
      setStatus(res);
      setThreshold(res.config.l2Threshold);
      setPositiveAlpha(res.config.positiveAlpha ?? DEFAULT_FILTER_CONFIG.positiveAlpha);
      setPositiveMinSim(res.config.positiveMinSim ?? DEFAULT_FILTER_CONFIG.positiveMinSim);
      setPetSkin(res.config.petSkin ?? DEFAULT_FILTER_CONFIG.petSkin);
      setSyncNativeDislike(
        res.config.syncNativeDislike ?? DEFAULT_FILTER_CONFIG.syncNativeDislike,
      );
    });
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleThresholdChange = (value: number) => {
    setThreshold(value);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { l2Threshold: value } });
  };

  const handleAlphaChange = (value: number) => {
    setPositiveAlpha(value);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { positiveAlpha: value } });
  };

  const handlePosMinSimChange = (value: number) => {
    setPositiveMinSim(value);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { positiveMinSim: value } });
  };

  const handleSkinChange = (skinId: PetSkinId) => {
    setPetSkin(skinId);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { petSkin: skinId } });
  };

  const handleSyncDislikeChange = (enabled: boolean) => {
    setSyncNativeDislike(enabled);
    void sendMsg({ type: 'UPDATE_CONFIG', patch: { syncNativeDislike: enabled } });
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = ruleInput.trim();
    if (!val) return;
    setRuleInput('');
    await sendMsg({ type: 'ADD_RULE', kind: 'keyword', value: val });
    loadStatus();
  };

  const handleRemoveRule = async (id: number) => {
    await sendMsg({ type: 'REMOVE_RULE', id });
    loadStatus();
  };

  const handleSyncNow = async () => {
    setBackupMsg({ text: '正在同步到 Chrome 账号…' });
    try {
      const res = await sendMsg<SyncNowResponse>({ type: 'SYNC_NOW' });
      if (!res?.ok) {
        setBackupMsg({ text: res?.error ?? '云同步失败', error: true });
        return;
      }
      const pullText = res.pulledVectors > 0 ? `，拉取 ${res.pulledVectors} 条` : '';
      setBackupMsg({ text: `☁️ 已同步 ${res.syncedVectors} 条样本${pullText}` });
      loadStatus();
    } catch {
      setBackupMsg({ text: '云同步失败，请稍后重试', error: true });
    }
  };

  const handleExport = async () => {
    try {
      const res = await sendMsg<ExportDataResponse>({ type: 'EXPORT_DATA' });
      if (!res?.ok || !res.data) {
        setBackupMsg({ text: '导出失败，请稍后重试', error: true });
        return;
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attention-filter-pet-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg({ text: `已导出 ${res.data.vectors.length} 条样本` });
    } catch {
      setBackupMsg({ text: '导出失败，请检查权限', error: true });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as PetDataBackup;
      const res = await sendMsg<ImportDataResponse>({
        type: 'IMPORT_DATA',
        data: parsed,
        mode: 'merge',
      });
      if (!res?.ok) {
        setBackupMsg({ text: res?.error ?? '导入失败：格式无效', error: true });
        return;
      }
      setBackupMsg({
        text: `已导入 ${res.importedVectors} 条样本、${res.importedRules} 条规则`,
      });
      loadStatus();
    } catch {
      setBackupMsg({ text: '导入失败：无法解析 JSON 文件', error: true });
    }
  };

  const activeSkin = getPetSkin(petSkin);

  const backendLabel =
    status?.backend === 'webgpu'
      ? 'WebGPU 语义加速'
      : status?.backend === 'wasm'
        ? 'WASM 语义加速'
        : status?.modelLoading
          ? '词面向量（模型下载中…）'
          : '词面向量模式（离线可用）';

  return (
    <div className="w-80 p-4 bg-slate-950 text-slate-100 space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="w-10 h-10 flex items-center justify-center shrink-0"
            dangerouslySetInnerHTML={{
              __html: activeSkin.renderVisual('idle', 'w-10 h-10'),
            }}
          />
          <div>
            <h1 className="text-sm font-semibold">Attention Filter Pet</h1>
            <p className="text-xs text-slate-400">当前形象：{activeSkin.name}</p>
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
        <div className="text-xs text-slate-300">宠物形象</div>
        <div className="grid grid-cols-2 gap-2">
          {PET_SKINS.map((skin) => {
            const active = skin.id === petSkin;
            return (
              <button
                key={skin.id}
                type="button"
                onClick={() => handleSkinChange(skin.id)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition cursor-pointer ${
                  active
                    ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                    : 'border-slate-700 bg-slate-800/70 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span
                  className="w-6 h-6 shrink-0 inline-flex items-center justify-center"
                  dangerouslySetInnerHTML={{
                    __html: skin.renderVisual('idle', 'w-6 h-6'),
                  }}
                />
                <span>{skin.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg bg-slate-900 p-3 border border-slate-800 space-y-2">
        <div className="text-xs text-slate-300">关键词 / UP 主黑名单（L1 秒拦）</div>
        <form onSubmit={(e) => void handleAddRule(e)} className="flex gap-1.5">
          <input
            type="text"
            value={ruleInput}
            onChange={(e) => setRuleInput(e.target.value)}
            placeholder="屏蔽词（逗号分隔，如 保姆级,王炸）"
            className="flex-1 min-w-0 rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-400"
          />
          <button
            type="submit"
            className="rounded-md px-2.5 py-1 text-xs font-medium border border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 cursor-pointer shrink-0"
          >
            添加
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {(status?.rules ?? []).length === 0 ? (
            <span className="text-[11px] text-slate-500">暂无自定义屏蔽词</span>
          ) : (
            (status?.rules ?? []).map((rule) => (
              <span
                key={rule.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] bg-orange-500/15 border border-orange-500/35 text-orange-200"
              >
                <span>
                  {rule.kind === 'author_block' ? '👤 UP:' : '🚫 '}
                  {rule.value}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemoveRule(rule.id)}
                  className="hover:text-white cursor-pointer"
                  title="移除规则"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg bg-slate-900 p-3 border border-slate-800 space-y-2">
        <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
          <span>投喂时同步点 B 站「不感兴趣」</span>
          <input
            type="checkbox"
            checked={syncNativeDislike}
            onChange={(e) => handleSyncDislikeChange(e.target.checked)}
            className="accent-sky-400 w-3.5 h-3.5 cursor-pointer"
          />
        </label>
      </section>

      <section className="rounded-lg bg-slate-900 p-3 border border-slate-800 space-y-2">
        <div className="text-xs text-slate-300">云同步与备份</div>
        <button
          type="button"
          onClick={() => void handleSyncNow()}
          className="w-full rounded-lg px-2.5 py-1.5 text-xs font-medium border border-sky-500/45 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25 transition cursor-pointer"
        >
          ☁️ 立即云同步（Chrome 账号自动漫游）
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-sky-400 transition cursor-pointer"
          >
            导出 JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium border border-slate-700 bg-slate-800/80 text-slate-200 hover:border-sky-400 transition cursor-pointer"
          >
            导入 JSON
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void handleImportFile(file).finally(() => {
              e.target.value = '';
            });
          }}
        />
        {backupMsg && (
          <p className={`text-[11px] ${backupMsg.error ? 'text-rose-400' : 'text-emerald-400'}`}>
            {backupMsg.text}
          </p>
        )}
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

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-300">白库排斥系数 α（越小保护越柔和）</span>
          <span className="font-mono text-emerald-400">{positiveAlpha.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={0.5}
          step={0.01}
          value={positiveAlpha}
          onChange={(e) => handleAlphaChange(Number(e.target.value))}
          className="w-full accent-emerald-400"
        />

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-300">白库触发门槛（高于此相似度才保护）</span>
          <span className="font-mono text-emerald-400">{positiveMinSim.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={0.95}
          step={0.01}
          value={positiveMinSim}
          onChange={(e) => handlePosMinSimChange(Number(e.target.value))}
          className="w-full accent-emerald-400"
        />

        <p className="text-[11px] text-slate-500">
          所有计算与向量均保存在本地 IndexedDB，无任何数据上传。
        </p>
      </section>
    </div>
  );
}
