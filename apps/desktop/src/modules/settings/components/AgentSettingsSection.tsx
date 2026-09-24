import { SettingSwitch } from './SettingsPrimitives';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Bot,
  PlugZap,
  Plus,
  ShieldCheck,
  Trash2,
  Workflow,
  Wrench
} from 'lucide-react';
import { type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  subagentOutputLabel
} from '@/shared/lib/agentRuntimeSettings';
import type {
  AgentProfile,
  AgentMcpServer,
  AgentRuntimeSettings,
  SubagentProfile
} from '@/shared/types/agentRuntime';

export type AgentSettingsView = 'main-agent' | 'subagents';

type AgentSettingsSectionProps = {
  llmProfiles: { id: string; model: string; name: string }[];
  onAddAgent: () => void;
  onRemoveAgent: (agentId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onUpdateAgent: (nextAgent: AgentProfile) => void;
  onUpdateRuntimeSettings: (nextSettings: AgentRuntimeSettings) => void;
  runtimeSettings: AgentRuntimeSettings;
  selectedAgentId: string | null;
  view: AgentSettingsView;
};

export function AgentSettingsSection({
  llmProfiles,
  onSelectAgent,
  onUpdateAgent,
  onUpdateRuntimeSettings,
  runtimeSettings,
  selectedAgentId,
  view
}: AgentSettingsSectionProps) {
  const selectedSubagent =
    runtimeSettings.subagents.find((agent) => agent.id === selectedAgentId) ??
    runtimeSettings.subagents[0] ??
    null;
  const workerSubagents = runtimeSettings.subagents;

  if (view === 'main-agent') {
    return (
      <div className="grid gap-4">
        <AgentSettingsHeader
          description="主 Agent 是唯一直接与用户对话的执行者。它先接收任务合同，再决定直接回答、调用工具或委派专项子 Agent。"
          title="主助手"
        />

        <div className="settings-agent-columns grid items-start gap-4">
        <EditorPanel description="配置身份、模型和职责；运行权限在“执行权限”中管理。" title="身份与模型">
          <AgentCommonFields
            agent={runtimeSettings.mainAssistant}
            llmProfiles={llmProfiles}
            roleLabel="全局主助手"
            showSystemPrompt={false}
            onUpdate={onUpdateAgent}
          />
        </EditorPanel>

        <EditorPanel description="这些开关决定主 Agent 在执行阶段能做什么。" title="执行权限">
          <div className="settings-fields-grid grid gap-3">
            <SwitchRow
              checked={runtimeSettings.mainAssistant.permissions.canInvokeSubagents}
              id="agent-delegation" label="允许委派子 Agent"
              onCheckedChange={(checked) =>
                onUpdateAgent({
                  ...runtimeSettings.mainAssistant,
                  permissions: {
                    ...runtimeSettings.mainAssistant.permissions,
                    canInvokeSubagents: checked
                  }
                })
              }
            />
            <SwitchRow
              checked={runtimeSettings.mainAssistant.permissions.canInvokeTools}
              description="关闭后只能进行不依赖外部观察的回答。"
              id="agent-tools" label="允许调用工具"
              onCheckedChange={(checked) =>
                onUpdateAgent({
                  ...runtimeSettings.mainAssistant,
                  permissions: {
                    ...runtimeSettings.mainAssistant.permissions,
                    canInvokeTools: checked
                  }
                })
              }
            />
            <SwitchRow
              checked={runtimeSettings.mainAssistant.permissions.canWriteProposals}
              id="agent-proposals" label="允许生成写入提案"
              onCheckedChange={(checked) =>
                onUpdateAgent({
                  ...runtimeSettings.mainAssistant,
                  permissions: {
                    ...runtimeSettings.mainAssistant.permissions,
                    canWriteProposals: checked
                  }
                })
              }
            />
          </div>
          <AssignmentSelector
            description="系统子 Agent 会自动参与固定阶段；这里只控制主 Agent 可以按需委派的任务型 worker。"
            emptyText="当前没有任务型子 Agent。"
            items={workerSubagents.map((agent) => ({
              description: agent.description,
              disabled: !agent.enabled,
              id: agent.id,
              label: agent.name
            }))}
            label="可委派的任务型子 Agent"
            selectedIds={runtimeSettings.mainAssistant.allowedSubagentIds}
            onToggle={(agentId) =>
              onUpdateRuntimeSettings({
                ...runtimeSettings,
                mainAssistant: {
                  ...runtimeSettings.mainAssistant,
                  allowedSubagentIds: toggleId(
                    runtimeSettings.mainAssistant.allowedSubagentIds,
                    agentId
                  )
                }
              })
            }
          />
        </EditorPanel>
        </div>

        <details className="group rounded-lg border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
            <Wrench className="text-muted-foreground" size={14} />
            高级设置
            <span className="ml-auto text-xs font-normal text-muted-foreground">系统提示词与 MCP 授权</span>
          </summary>
          <div className="grid gap-4 border-t p-4">
            <Field label="主 Agent 系统提示词">
              <Textarea
                className="min-h-36 font-mono text-xs leading-5"
                value={runtimeSettings.mainAssistant.systemPrompt}
                onChange={(event) => onUpdateAgent({
                  ...runtimeSettings.mainAssistant,
                  systemPrompt: event.target.value
                })}
              />
            </Field>
          <McpServerSelector
            agent={runtimeSettings.mainAssistant}
            runtimeSettings={runtimeSettings}
            onUpdate={onUpdateAgent}
          />
          </div>
        </details>
      </div>
    );
  }

  return (
      <div className="grid gap-4">
        <AgentSettingsHeader
          description="子 Agent 使用独立上下文执行主助手委派的只读专项工作，共享运行预算与溯源。任务理解、记忆压缩和翻译是固定模型任务，不是子 Agent。"
          title="子助手"
        />

        <div className="settings-agent-master-detail grid items-start gap-4">
          <SettingsCollectionCard icon={Workflow} title={`内置子 Agent · ${runtimeSettings.subagents.length}`}>
            <CollectionGroupLabel>任务执行</CollectionGroupLabel>
            {workerSubagents.map((agent) => (
              <SelectableRow
                key={agent.id}
                active={selectedSubagent?.id === agent.id}
                label={agent.name}
                meta={`${agent.enabled ? '启用' : '停用'} · ${subagentPurposeLabel(agent)}`}
                onClick={() => onSelectAgent(agent.id)}
              />
            ))}
          </SettingsCollectionCard>

          {selectedSubagent ? (
            <EditorPanel
              description="配置该 worker 的模型、提示词和权限。"
              title={selectedSubagent.name}
            >
              <SubagentEditor
                agent={selectedSubagent}
                llmProfiles={llmProfiles}
                assignedToMain={runtimeSettings.mainAssistant.allowedSubagentIds.includes(selectedSubagent.id)}
                onAssignmentChange={(assigned) =>
                  onUpdateRuntimeSettings({
                    ...runtimeSettings,
                    mainAssistant: {
                      ...runtimeSettings.mainAssistant,
                      allowedSubagentIds: assigned
                        ? [...new Set([...runtimeSettings.mainAssistant.allowedSubagentIds, selectedSubagent.id])]
                        : runtimeSettings.mainAssistant.allowedSubagentIds.filter((id) => id !== selectedSubagent.id)
                    }
                  })
                }
                onUpdate={onUpdateAgent}
              />
            </EditorPanel>
          ) : (
            <EditorPanel description="当前没有可配置的子 Agent。" title="子助手">
              <div className="text-xs text-muted-foreground">暂无子 Agent。</div>
            </EditorPanel>
          )}
        </div>
      </div>
  );
}

function AgentSettingsHeader({
  action,
  description,
  title
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function AssignmentSelector({ description, emptyText, items, label, onToggle, selectedIds }: {
  description: string;
  emptyText: string;
  items: Array<{ description: string; disabled?: boolean; id: string; label: string }>;
  label: string;
  onToggle: (id: string) => void;
  selectedIds: string[];
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p>
      </div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-border/70 bg-background p-2">
        {items.length === 0 ? <div className="px-1 py-2 text-xs text-muted-foreground">{emptyText}</div> : null}
        {items.map((item) => (
          <label className={`flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 ${item.disabled ? 'opacity-55' : ''}`} key={item.id}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.description}</span>
            </span>
            <Checkbox aria-label={item.label} checked={selectedIds.includes(item.id)} disabled={item.disabled} onCheckedChange={() => onToggle(item.id)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function CollectionGroupLabel({ children }: { children: ReactNode }) {
  return <div className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</div>;
}

function subagentPurposeLabel(_agent: SubagentProfile) {
  return '证据检索与整理';
}

function subagentExecutionDescription(_agent: SubagentProfile) {
  return '仅在需要跨文献检索和阅读证据时接受委派，并返回带来源的证据摘要。';
}


function AgentCommonFields({
  agent,
  llmProfiles,
  onUpdate,
  roleLabel,
  showSystemPrompt = true
}: {
  agent: AgentProfile;
  llmProfiles: { id: string; model: string; name: string }[];
  onUpdate: (nextAgent: AgentProfile) => void;
  roleLabel: string;
  showSystemPrompt?: boolean;
}) {
  return (
    <>
      <div className="settings-fields-grid grid gap-3">
        <Field label="名称">
          <Input value={agent.name} onChange={(event) => onUpdate({ ...agent, name: event.target.value })} />
        </Field>
        <ReadOnlyValue label="角色" value={roleLabel} />
      </div>

      <Field label="使用的大模型配置">
        <Select
          value={agent.llmProfileId ?? '__assistant_default__'}
          onValueChange={(value) =>
            onUpdate({
              ...agent,
              llmProfileId: value === '__assistant_default__' ? null : value
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__assistant_default__">跟随对话任务模型</SelectItem>
            {llmProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name} · {profile.model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="说明">
        <Input
          value={agent.description}
          onChange={(event) => onUpdate({ ...agent, description: event.target.value })}
        />
      </Field>

      {showSystemPrompt ? <Field label="系统提示词">
        <Textarea
          className="min-h-28"
          value={agent.systemPrompt}
          onChange={(event) => onUpdate({ ...agent, systemPrompt: event.target.value })}
        />
      </Field> : null}
    </>
  );
}

function SubagentEditor({
  agent, assignedToMain, llmProfiles, onAssignmentChange, onUpdate
}: {
  agent: SubagentProfile;
  assignedToMain: boolean;
  llmProfiles: { id: string; model: string; name: string }[];
  onAssignmentChange: (assigned: boolean) => void;
  onUpdate: (nextAgent: AgentProfile) => void;
}) {
  return (
    <>
      <div className="text-xs leading-5 text-muted-foreground">
        <div className="font-medium text-foreground">{subagentPurposeLabel(agent)}</div>
        <div>{subagentExecutionDescription(agent)}</div>
      </div>
      <AgentCommonFields agent={agent} llmProfiles={llmProfiles}
        roleLabel={`子 Agent · ${subagentOutputLabel(agent.outputKind)}`}
        showSystemPrompt={false} onUpdate={onUpdate} />
      <ReadOnlyValue label="执行边界" value="独立上下文 · 只读工具 · 共享预算与溯源 · 不直接写入资料库或调用外部 MCP" />
      <SwitchRow checked={agent.enabled} description="停用后不会参与后续任务。" label="启用此子助手"
        onCheckedChange={checked => onUpdate({ ...agent, enabled: checked })} />
      <SwitchRow checked={assignedToMain} description="允许主 Agent 在需要时把专项任务交给它。"
        label="允许主 Agent 委派" onCheckedChange={onAssignmentChange} />
      <details className="group rounded-lg border border-border/70 bg-background">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">高级权限与提示词</summary>
        <div className="grid gap-3 border-t p-3">
          <SwitchRow checked={agent.permissions.canInvokeTools} label="允许调用工具"
            onCheckedChange={checked => onUpdate({ ...agent, permissions: { ...agent.permissions, canInvokeTools: checked } })} />
          <SwitchRow checked={agent.permissions.canReadWorkspaceWide} label="允许读取全局 Workspace"
            onCheckedChange={checked => onUpdate({ ...agent, permissions: { ...agent.permissions, canReadWorkspaceWide: checked } })} />
          <Field label="系统提示词">
            <Textarea className="min-h-36 font-mono text-xs leading-5" value={agent.systemPrompt}
              onChange={event => onUpdate({ ...agent, systemPrompt: event.target.value })} />
          </Field>
        </div>
      </details>
    </>
  );
}


function McpServerSelector({
  agent,
  onUpdate,
  runtimeSettings
}: {
  agent: AgentProfile;
  onUpdate: (nextAgent: AgentProfile) => void;
  runtimeSettings: AgentRuntimeSettings;
}) {
  return (
    <TagSelector
      label="允许使用的 MCP 服务"
      options={runtimeSettings.mcpServers.map((server) => ({
        id: server.id,
        label: `${server.name}${server.enabled ? '' : ' (disabled)'}`
      }))}
      selectedIds={agent.allowedMcpServerIds ?? []}
      onToggle={(serverId) =>
        onUpdate({
          ...agent,
          allowedMcpServerIds: toggleId(agent.allowedMcpServerIds ?? [], serverId)
        })
      }
    />
  );
}

export function AgentToolRuntimeSection({
  onUpdateRuntimeSettings,
  runtimeSettings
}: {
  onUpdateRuntimeSettings: (nextSettings: AgentRuntimeSettings) => void;
  runtimeSettings: AgentRuntimeSettings;
}) {
  const addMcpServer = () => {
    const nextIndex = runtimeSettings.mcpServers.length + 1;
    const nextServer: AgentMcpServer = {
      allowedToolNames: [],
      command: '',
      description: '',
      enabled: true,
      id: `mcp-server-${nextIndex}`,
      name: `MCP Server ${nextIndex}`
    };
    onUpdateRuntimeSettings({
      ...runtimeSettings,
      mcpServers: [...runtimeSettings.mcpServers, nextServer],
      toolPackages: [
        ...runtimeSettings.toolPackages,
        {
          allowedToolIds: [],
          description: 'Tools exposed through this MCP server.',
          enabled: true,
          id: `mcp-tool-package-${nextIndex}`,
          kind: 'mcp',
          mcpServerId: nextServer.id,
          name: `${nextServer.name} tools`,
          permissionMode: 'ask'
        }
      ]
    });
  };

  const updateMcpServer = (serverId: string, patch: Partial<AgentMcpServer>) => {
    onUpdateRuntimeSettings({
      ...runtimeSettings,
      mcpServers: runtimeSettings.mcpServers.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server
      )
    });
  };

  const removeMcpServer = (serverId: string) => {
    onUpdateRuntimeSettings({
      ...runtimeSettings,
      mainAssistant: {
        ...runtimeSettings.mainAssistant,
        allowedMcpServerIds: (runtimeSettings.mainAssistant.allowedMcpServerIds ?? []).filter(
          (id) => id !== serverId
        )
      },
      mcpServers: runtimeSettings.mcpServers.filter((server) => server.id !== serverId),
      subagents: runtimeSettings.subagents.map((agent) => ({
        ...agent,
        allowedMcpServerIds: (agent.allowedMcpServerIds ?? []).filter((id) => id !== serverId)
      })),
      toolPackages: runtimeSettings.toolPackages.filter(
        (toolPackage) => toolPackage.mcpServerId !== serverId
      )
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-background p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PlugZap className="shrink-0 text-muted-foreground" size={14} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">MCP 与工具入口</div>
            <div className="text-xs text-muted-foreground">
              注册经授权的可执行工具入口。
            </div>
          </div>
        </div>
        <Button size="xs" type="button" variant="outline" onClick={addMcpServer}>
          <Plus />
          添加 MCP
        </Button>
      </div>
      {runtimeSettings.mcpServers.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          尚未配置 MCP 服务。
        </div>
      ) : (
        <div className="grid gap-2">
          {runtimeSettings.mcpServers.map((server) => (
            <div key={server.id} className="grid gap-2 rounded-md border border-border/70 p-3">
              <div className="settings-mcp-fields grid gap-2">
                <Input
                  value={server.name}
                  onChange={(event) => updateMcpServer(server.id, { name: event.target.value })}
                />
                <Input
                  placeholder="启动命令，例如 npx @modelcontextprotocol/server-filesystem"
                  value={server.command}
                  onChange={(event) => updateMcpServer(server.id, { command: event.target.value })}
                />
                <Button
                  size="icon-sm"
                  title="移除 MCP 服务"
                  type="button"
                  variant="ghost"
                  onClick={() => removeMcpServer(server.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <Input
                placeholder="允许的工具名称，用逗号分隔"
                value={server.allowedToolNames.join(', ')}
                onChange={(event) =>
                  updateMcpServer(server.id, {
                    allowedToolNames: event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  })
                }
              />
              <SwitchRow
                checked={server.enabled}
                label="启用此 MCP 服务"
                onCheckedChange={(checked) => updateMcpServer(server.id, { enabled: checked })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsCollectionCard({
  actionLabel,
  children,
  extraAction,
  icon: Icon,
  onAction,
  title
}: {
  actionLabel?: string;
  children: ReactNode;
  extraAction?: ReactNode;
  icon: typeof Bot;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-muted p-1.5 text-muted-foreground">
            <Icon size={14} />
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {actionLabel || extraAction ? (
          <div className="flex gap-1">
            {extraAction}
            {actionLabel && onAction ? (
              <Button size="xs" type="button" variant="outline" onClick={onAction}>
                <Plus />
                {actionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function EditorPanel({
  children,
  description,
  onRemove,
  title
}: {
  children: ReactNode;
  description: string;
  onRemove?: () => void;
  title: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {onRemove ? (
          <Button size="xs" type="button" variant="ghost" onClick={onRemove}>
            <Trash2 />
            删除
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SelectableRow({
  active,
  label,
  meta,
  onClick
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-lg border px-3 py-2 text-left transition ${
        active
          ? 'border-primary/35 bg-primary/6 shadow-sm'
          : 'border-border/70 bg-background hover:border-primary/20 hover:bg-muted/25'
      }`}
      type="button"
      onClick={onClick}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{meta}</div>
    </button>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        {value}
      </div>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SwitchRow({
  id,
  checked,
  description,
  disabled = false,
  label,
  onCheckedChange
}: {
  id?: string;
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return <SettingSwitch id={id} label={label} description={description} disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} />;

}

function TagSelector({
  label,
  onToggle,
  options,
  selectedIds
}: {
  label: string;
  onToggle: (id: string) => void;
  options: Array<{ id: string; label: string }>;
  selectedIds: string[];
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-background p-3">
        {options.length === 0 ? (
          <span className="text-xs text-muted-foreground">暂无可选项</span>
        ) : null}
        {options.map((option) => {
          const active = selectedIds.includes(option.id);
          return (
            <button
              key={option.id}
              className="text-left"
              type="button"
              onClick={() => onToggle(option.id)}
            >
              <Badge variant={active ? 'default' : 'outline'}>{option.label}</Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
