import { Play, Square, Unplug, ChevronDown, ChevronUp, Users, Terminal, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { MemberBadge } from "./MemberBadge";
import { TeamOutput } from "./TeamOutput";
import type { TeamConfig } from "@/types/board";
import type { TeamState } from "@/types/team";
import type { Task } from "@/types/board";
import { useState } from "react";

interface TeamPanelProps {
  config: TeamConfig;
  state?: TeamState;
  running: boolean;
  tasks: Task[];
  onStart: () => void;
  onStop: () => void;
  onDisconnect: () => void;
  onUpdateConfig: (updates: Partial<TeamConfig>) => Promise<void>;
}

export function TeamPanel({
  config,
  state,
  running,
  tasks,
  onStart,
  onStop,
  onDisconnect,
  onUpdateConfig,
}: TeamPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showOutput, setShowOutput] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const activeMembers = state?.members ?? [];
  const configuredMembers = config.members ?? [];

  function getTaskTitle(taskId?: string) {
    if (!taskId) return undefined;
    return tasks.find((t) => t.id === taskId)?.title;
  }

  async function handleAddMember() {
    const name = newMemberName.trim();
    if (!name || configuredMembers.includes(name)) return;
    await onUpdateConfig({ members: [...configuredMembers, name] });
    setNewMemberName("");
  }

  async function handleRemoveMember(name: string) {
    await onUpdateConfig({ members: configuredMembers.filter((m) => m !== name) });
  }

  // Merge configured + active: configured members are the roster,
  // active members not in roster are shown as auto-derived workers.
  const configuredSet = new Set(configuredMembers);
  const extraActive = activeMembers.filter((m) => !configuredSet.has(m.name));

  return (
    <div className="border-b bg-card shrink-0">
      <div className="px-6 py-2 flex items-center justify-between">
        <button
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          onClick={() => setExpanded(!expanded)}
        >
          <Users className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{config.teamName}</span>
          <Badge
            variant={running ? "default" : "secondary"}
            className="text-[10px] px-1.5 py-0"
          >
            {running ? "Running" : "Stopped"}
          </Badge>
          {(configuredMembers.length > 0 || activeMembers.length > 0) && (
            <span className="text-xs text-muted-foreground">
              {configuredMembers.length > 0
                ? `${configuredMembers.length} worker${configuredMembers.length !== 1 ? "s" : ""}`
                : `${activeMembers.length} active`}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="size-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3 text-muted-foreground" />
          )}
        </button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={showOutput ? "secondary" : "ghost"}
            onClick={() => setShowOutput((v) => !v)}
            title="Toggle output panel"
          >
            <Terminal className="size-3" />
            Output
          </Button>
          {running ? (
            <Button size="sm" variant="outline" onClick={onStop}>
              <Square className="size-3" />
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onStart}>
              <Play className="size-3" />
              Start
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDisconnect}>
            <Unplug className="size-3" />
          </Button>
        </div>
      </div>
      {expanded && (
        <>
          <Separator />
          <div className="px-6 py-2 space-y-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>Project:</span>
              {config.repos && config.repos.length > 1 ? (
                <span className="font-mono truncate">
                  {config.repos.map((r) => r.name).join(", ")}
                </span>
              ) : (
                <span className="font-mono truncate">{config.projectDir}</span>
              )}
              <span className="mx-1">·</span>
              <span className="capitalize">{config.model || "sonnet"}</span>
            </div>

            {/* Configured worker roster */}
            {configuredMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {configuredMembers.map((name) => {
                  const live = activeMembers.find((m) => m.name === name);
                  return (
                    <div key={name} className="flex items-center gap-1 group">
                      <MemberBadge
                        name={name}
                        status={live?.status ?? "idle"}
                        model={live?.model ?? config.workerModel ?? "sonnet"}
                        currentTaskTitle={getTaskTitle(live?.currentTask)}
                      />
                      <button
                        onClick={() => handleRemoveMember(name)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title={`Remove ${name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Auto-derived active workers not in the configured roster */}
            {extraActive.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {extraActive.map((m) => (
                  <MemberBadge
                    key={m.name}
                    name={m.name}
                    status={m.status}
                    model={m.model}
                    currentTaskTitle={getTaskTitle(m.currentTask)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {configuredMembers.length === 0 && activeMembers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {running
                  ? "Waiting for agents to join..."
                  : "No workers configured. Add named workers below, or start the team to use auto-named workers."}
              </p>
            )}

            {/* Add worker input */}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleAddMember();
              }}
            >
              <Input
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add worker (e.g. alice)"
                className="h-7 text-xs"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={!newMemberName.trim() || configuredMembers.includes(newMemberName.trim())}
              >
                <Plus className="size-3" />
              </Button>
            </form>
          </div>
        </>
      )}
      {showOutput && <TeamOutput running={running} />}
    </div>
  );
}
