import { Play, Square, Unplug, ChevronDown, ChevronUp, Users, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
}

export function TeamPanel({
  config,
  state,
  running,
  tasks,
  onStart,
  onStop,
  onDisconnect,
}: TeamPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showOutput, setShowOutput] = useState(false);
  const members = state?.members ?? [];

  function getTaskTitle(taskId?: string) {
    if (!taskId) return undefined;
    return tasks.find((t) => t.id === taskId)?.title;
  }

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
          {members.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {members.length} member{members.length !== 1 ? "s" : ""}
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
          <div className="px-6 py-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <span>Project:</span>
              <span className="font-mono truncate">{config.projectDir}</span>
              <span className="mx-1">·</span>
              <span className="capitalize">{config.model || "sonnet"}</span>
            </div>
            {members.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {members.map((m) => (
                  <MemberBadge
                    key={m.name}
                    name={m.name}
                    status={m.status}
                    currentTaskTitle={getTaskTitle(m.currentTask)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {running
                  ? "Waiting for agents to join..."
                  : "No team members yet. Start the team to spawn agents."}
              </p>
            )}
          </div>
        </>
      )}
      {showOutput && <TeamOutput running={running} />}
    </div>
  );
}
