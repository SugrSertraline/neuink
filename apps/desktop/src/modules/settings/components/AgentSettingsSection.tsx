import { Bot, FolderOpen, PackagePlus, PlugZap, Plus, Trash2, Workflow } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  createBlankSkillPackage,
  listSkillPackageCategories,
  subagentOutputLabel
} from '@/shared/lib/agentRuntimeSettings';
import type {
  AgentProfile,
  AgentMcpServer,
  AgentRuntimeSettings,
  SkillPackage,
  SubagentProfile
} from '@/shared/types/agentRuntime';

export type AgentSettingsView = 'main-agent' | 'subagents' | 'skills';

type AgentSettingsSectionProps = {
  llmProfiles: { id: string; model: string; name: string }[];
  onAddAgent: () => void;
  onAddSkillPackage: () => void;
  onImportSkillPackage: () => void;
  onOpenSkillPackageFolder: (skillPackage: SkillPackage) => void;
  onRemoveAgent: (agentId: string) => void;
  onRemoveSkillPackage: (skillPackageId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSelectSkillPackage: (skillPackageId: string) => void;
  onUpdateAgent: (nextAgent: AgentProfile) => void;
  onUpdateRuntimeSettings: (nextSettings: AgentRuntimeSettings) => void;
  onUpdateSkillPackage: (nextSkillPackage: SkillPackage) => void;
  runtimeSettings: AgentRuntimeSettings;
  selectedAgentId: string | null;
  selectedSkillPackageId: string | null;
  view: AgentSettingsView;
};

export function AgentSettingsSection({
  llmProfiles,
  onAddSkillPackage,
  onImportSkillPackage,
  onOpenSkillPackageFolder,
  onRemoveSkillPackage,
  onSelectAgent,
  onSelectSkillPackage,
  onUpdateAgent,
  onUpdateRuntimeSettings,
  onUpdateSkillPackage,
  runtimeSettings,
  selectedAgentId,
  selectedSkillPackageId,
  view
}: AgentSettingsSectionProps) {
  const selectedSubagent =
    runtimeSettings.subagents.find((agent) => agent.id === selectedAgentId) ??
    runtimeSettings.subagents[0] ??
    null;
  const selectedSkillPackage =
    runtimeSettings.skillPackages.find((skillPackage) => skillPackage.id === selectedSkillPackageId) ??
    runtimeSettings.skillPackages[0] ??
    createBlankSkillPackage(0);
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);

  if (view === 'main-agent') {
    return (
      <div className="grid gap-6">
        <div>
          <h2 className="text-base font-semibold">主 Agent</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Neuink 只有一个全局主助手，负责直接响应用户、加载 Skills、调用工具，并按需委派内置子 Agent。
          </p>
        </div>

        <EditorPanel description="配置全局主助手的模型、提示词和可委派能力。" title="主助手">
          <AgentCommonFields
            agent={runtimeSettings.mainAssistant}
            llmProfiles={llmProfiles}
            roleLabel="全局主助手"
            onUpdate={onUpdateAgent}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <SwitchRow
              checked={runtimeSettings.mainAssistant.permissions.canInvokeSubagents}
              label="允许委派子 Agent"
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
              checked={runtimeSettings.mainAssistant.permissions.canWriteProposals}
              label="允许生成写入提案"
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
          <TagSelector
            label="主助手可加载的 Skills"
            options={runtimeSettings.skillPackages.map((skillPackage) => ({
              id: skillPackage.id,
              label: skillPackage.name
            }))}
            selectedIds={runtimeSettings.mainAssistant.allowedSkillPackageIds}
            onToggle={(skillPackageId) =>
              onUpdateAgent({
                ...runtimeSettings.mainAssistant,
                allowedSkillPackageIds: toggleId(
                  runtimeSettings.mainAssistant.allowedSkillPackageIds,
                  skillPackageId
                )
              })
            }
          />
          <McpServerSelector
            agent={runtimeSettings.mainAssistant}
            runtimeSettings={runtimeSettings}
            onUpdate={onUpdateAgent}
          />
          <ToolPackageEditor
            runtimeSettings={runtimeSettings}
            onUpdateRuntimeSettings={onUpdateRuntimeSettings}
          />
        </EditorPanel>
      </div>
    );
  }

  if (view === 'subagents') {
    return (
      <div className="grid gap-6">
        <div>
          <h2 className="text-base font-semibold">子 Agent</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            子 Agent 是内部 worker，不作为聊天角色。当前只保留 EvidenceAgent 和 PatchPlannerAgent。
          </p>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <SettingsCollectionCard icon={Workflow} title="内置子 Agent">
            {runtimeSettings.subagents.map((agent) => (
              <SelectableRow
                key={agent.id}
                active={selectedSubagent?.id === agent.id}
                label={agent.name}
                meta={`${agent.enabled ? '启用' : '停用'} · ${subagentOutputLabel(agent.outputKind)}`}
                onClick={() => onSelectAgent(agent.id)}
              />
            ))}
          </SettingsCollectionCard>

          {selectedSubagent ? (
            <EditorPanel
              description="配置该 worker 的模型、提示词、权限和可用 Skills。"
              title={selectedSubagent.name}
            >
              <SubagentEditor
                agent={selectedSubagent}
                llmProfiles={llmProfiles}
                runtimeSettings={runtimeSettings}
                onUpdate={onUpdateAgent}
              />
            </EditorPanel>
          ) : (
            <EditorPanel description="当前没有可配置的子 Agent。" title="子 Agent">
              <div className="text-xs text-muted-foreground">暂无子 Agent。</div>
            </EditorPanel>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-base font-semibold">Skills</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Skill 是知识和经验包。这里维护 Neuink 元信息，SKILL.md 和资源文件保持只读预览。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{runtimeSettings.skillPackages.length} 个已安装技能 · 按任务关键词自动选择</div>
        <div className="flex gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onImportSkillPackage}><PackagePlus />导入 Skill</Button>
          <Button size="sm" type="button" onClick={onAddSkillPackage}><Plus />新建 Skill</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {runtimeSettings.skillPackages.map((skillPackage) => {
          const active = selectedSkillPackage.id === skillPackage.id;
          return (
            <Card key={skillPackage.id} size="sm" className={active ? 'border-primary bg-primary/[0.04]' : 'hover:border-primary/45'}>
              <CardHeader>
                <CardTitle className="truncate">{skillPackage.name}</CardTitle>
                <CardAction className="flex items-center gap-2">
                  <Badge variant={skillPackage.enabled ? 'default' : 'outline'}>{skillPackage.enabled ? '启用' : '停用'}</Badge>
                  <Switch
                    aria-label={`切换 ${skillPackage.name} 的启用状态`}
                    checked={skillPackage.enabled}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(enabled) => onUpdateSkillPackage({ ...skillPackage, enabled })}
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                <button
                  className="grid w-full gap-3 text-left"
                  type="button"
                  onClick={() => {
                    onSelectSkillPackage(skillPackage.id);
                    setSkillEditorOpen(true);
                  }}
                >
                  <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{skillPackage.description || '尚未添加说明。'}</p>
                  <div className="text-xs text-muted-foreground">{skillPackage.category} · {skillPackage.kind === 'builtin' ? '内置' : '已安装'}</div>
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={skillEditorOpen} onOpenChange={setSkillEditorOpen}>
        <DialogContent className="grid h-[min(760px,calc(100vh-3rem))] w-[min(860px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle>{selectedSkillPackage.name || 'Skill'}</DialogTitle>
            <DialogDescription>编辑技能行为、查看指令与资源。所有写入由应用服务控制。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <EditorPanel description="配置触发条件；指令内容与资源均保持独立查看。" title="技能配置" onRemove={() => onRemoveSkillPackage(selectedSkillPackage.id)}>
              <SkillPackageEditor skillPackage={selectedSkillPackage} onOpenFolder={() => onOpenSkillPackageFolder(selectedSkillPackage)} onUpdate={onUpdateSkillPackage} />
            </EditorPanel>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentCommonFields({
  agent,
  llmProfiles,
  onUpdate,
  roleLabel
}: {
  agent: AgentProfile;
  llmProfiles: { id: string; model: string; name: string }[];
  onUpdate: (nextAgent: AgentProfile) => void;
  roleLabel: string;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
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

      <Field label="系统提示词">
        <Textarea
          className="min-h-28"
          value={agent.systemPrompt}
          onChange={(event) => onUpdate({ ...agent, systemPrompt: event.target.value })}
        />
      </Field>
    </>
  );
}

function SubagentEditor({
  agent,
  llmProfiles,
  onUpdate,
  runtimeSettings
}: {
  agent: SubagentProfile;
  llmProfiles: { id: string; model: string; name: string }[];
  onUpdate: (nextAgent: AgentProfile) => void;
  runtimeSettings: AgentRuntimeSettings;
}) {
  return (
    <>
      <AgentCommonFields
        agent={agent}
        llmProfiles={llmProfiles}
        roleLabel={`子 Agent · ${subagentOutputLabel(agent.outputKind)}`}
        onUpdate={onUpdate}
      />
      <ReadOnlyValue
        label="SUBAGENT manifest"
        value={agent.subagentManifestPath ?? 'agent-runtime/subagents/<id>/SUBAGENT.toml'}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <SwitchRow
          checked={agent.enabled}
          label="启用此子 Agent"
          onCheckedChange={(checked) => onUpdate({ ...agent, enabled: checked })}
        />
        <SwitchRow
          checked={agent.permissions.canReadWorkspaceWide}
          label="允许读取全局 Workspace"
          onCheckedChange={(checked) =>
            onUpdate({
              ...agent,
              permissions: { ...agent.permissions, canReadWorkspaceWide: checked }
            })
          }
        />
        <SwitchRow
          checked={agent.permissions.canUseSkills}
          label="允许加载 Skills"
          onCheckedChange={(checked) =>
            onUpdate({
              ...agent,
              permissions: { ...agent.permissions, canUseSkills: checked }
            })
          }
        />
        <SwitchRow
          checked={agent.permissions.canWriteProposals}
          label="允许生成写入提案"
          onCheckedChange={(checked) =>
            onUpdate({
              ...agent,
              permissions: { ...agent.permissions, canWriteProposals: checked }
            })
          }
        />
      </div>

      <TagSelector
        label="允许加载的 Skills"
        options={runtimeSettings.skillPackages.map((skillPackage) => ({
          id: skillPackage.id,
          label: skillPackage.name
        }))}
        selectedIds={agent.allowedSkillPackageIds}
        onToggle={(skillPackageId) =>
          onUpdate({
            ...agent,
            allowedSkillPackageIds: toggleId(agent.allowedSkillPackageIds, skillPackageId)
          })
        }
      />
      <McpServerSelector agent={agent} runtimeSettings={runtimeSettings} onUpdate={onUpdate} />
    </>
  );
}

function SkillPackageEditor({
  onOpenFolder,
  onUpdate,
  skillPackage
}: {
  onOpenFolder: () => void;
  onUpdate: (nextSkillPackage: SkillPackage) => void;
  skillPackage: SkillPackage;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Badge variant={skillPackage.enabled ? 'default' : 'outline'}>
          {skillPackage.enabled ? '已启用' : '已停用'}
        </Badge>
        <span>{skillPackage.kind === 'builtin' ? '内置技能' : '已安装技能'}</span>
        <span>·</span>
        <span>{skillPackage.category}</span>
        <span>·</span>
        <span>v{skillPackage.version}</span>
      </div>

      <Tabs className="gap-4" defaultValue="behavior">
        <TabsList variant="line">
          <TabsTrigger value="behavior">行为</TabsTrigger>
          <TabsTrigger value="instructions">指令</TabsTrigger>
          <TabsTrigger value="resources">资源与来源</TabsTrigger>
        </TabsList>

        <TabsContent value="behavior">
          <div className="grid gap-4 pt-1">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="名称">
                <Input
                  value={skillPackage.name}
                  onChange={(event) => onUpdate({ ...skillPackage, name: event.target.value })}
                />
              </Field>
              <Field label="分类">
                <Select
                  value={skillPackage.category}
                  onValueChange={(value) =>
                    onUpdate({ ...skillPackage, category: value as SkillPackage['category'] })
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {listSkillPackageCategories().map((category) => (
                      <SelectItem key={category} value={category}>{category}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <SwitchRow
              checked={skillPackage.enabled}
              label="启用此技能包"
              onCheckedChange={(checked) => onUpdate({ ...skillPackage, enabled: checked })}
            />
            <Field label="说明">
              <Input value={skillPackage.description} onChange={(event) => onUpdate({ ...skillPackage, description: event.target.value })} />
            </Field>
            <Field label="触发关键词">
              <Input
                placeholder="用逗号分隔，例如：标签, 推荐标签"
                value={skillPackage.triggers.join(', ')}
                onChange={(event) => onUpdate({
                  ...skillPackage,
                  triggers: event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
                })}
              />
            </Field>
            <div className="rounded-lg border border-border/70 bg-background p-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">调用方式</div>
              <p className="mt-1 leading-5">匹配任务时，规划器会预加载此 Skill 的 SKILL.md；模型可据此调用已授权的工具。Skill 本身不绕过应用服务写入数据。</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="instructions">
          <div className="grid gap-3 pt-1">
            <div className="text-xs leading-5 text-muted-foreground">内置或已安装包的指令保持只读；如需修改完整 SKILL.md，请在本地文件夹中编辑后重新载入。</div>
            <Textarea className="h-[min(48vh,36rem)] resize-y font-mono text-xs leading-5" readOnly value={skillPackage.readme} />
            <Button disabled={!skillPackage.packagePath && !skillPackage.skillMarkdownPath} size="sm" type="button" variant="outline" onClick={onOpenFolder}>
              <FolderOpen /> 打开本地文件夹
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="resources">
          <div className="grid gap-3 pt-1">
            <div className="grid gap-2 rounded-lg border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
              <div>来源：{skillPackage.sourceArchivePath ?? '内置或手动创建'}</div>
              <div>安装路径：{skillPackage.packagePath ?? '尚未解包'}</div>
              <div>SKILL.md：{skillPackage.skillMarkdownPath ?? '内置内容'}</div>
              <div>脚本执行：{skillPackage.scriptExecution ?? 'disabled'}（必须通过 MCP 或 Tool Package 授权）</div>
            </div>
            <ResourceList title="references/" paths={skillPackage.resourcePaths?.references ?? []} />
            <ResourceList title="scripts/" paths={skillPackage.resourcePaths?.scripts ?? []} />
            <ResourceList title="assets/" paths={skillPackage.resourcePaths?.assets ?? []} />
          </div>
        </TabsContent>
      </Tabs>
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
      label="Allowed MCP servers"
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

function ToolPackageEditor({
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
          description: 'Tools exposed through this MCP server. Skill scripts are not executable unless exposed here.',
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
            <div className="text-sm font-semibold">MCP / Tool Packages</div>
            <div className="text-xs text-muted-foreground">
              Register executable tool entry points. Skill scripts remain non-executable unless exposed here.
            </div>
          </div>
        </div>
        <Button size="xs" type="button" variant="outline" onClick={addMcpServer}>
          <Plus />
          Add MCP
        </Button>
      </div>
      {runtimeSettings.mcpServers.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No MCP servers configured.
        </div>
      ) : (
        <div className="grid gap-2">
          {runtimeSettings.mcpServers.map((server) => (
            <div key={server.id} className="grid gap-2 rounded-md border border-border/70 p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
                <Input
                  value={server.name}
                  onChange={(event) => updateMcpServer(server.id, { name: event.target.value })}
                />
                <Input
                  placeholder="command, e.g. npx @modelcontextprotocol/server-filesystem"
                  value={server.command}
                  onChange={(event) => updateMcpServer(server.id, { command: event.target.value })}
                />
                <Button
                  size="icon-sm"
                  title="Remove MCP server"
                  type="button"
                  variant="ghost"
                  onClick={() => removeMcpServer(server.id)}
                >
                  <Trash2 />
                </Button>
              </div>
              <Input
                placeholder="Allowed tool names, comma separated"
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
                label="Enable this MCP server"
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
    <div className="grid gap-3 rounded-lg border bg-card p-4">
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
    <div className="grid gap-4 rounded-lg border bg-card p-4">
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
  checked,
  label,
  onCheckedChange
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
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

function ResourceList({ paths, title }: { paths: string[]; title: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border/70 bg-background p-3">
      <div className="text-xs font-semibold">{title}</div>
      {paths.length === 0 ? (
        <div className="text-xs text-muted-foreground">暂无文件</div>
      ) : (
        <div className="grid max-h-36 gap-1 overflow-auto">
          {paths.map((path) => (
            <div
              key={path}
              className="truncate rounded border border-border/50 bg-muted/20 px-2 py-1 font-mono text-[11px] text-muted-foreground"
              title={path}
            >
              {path}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}
