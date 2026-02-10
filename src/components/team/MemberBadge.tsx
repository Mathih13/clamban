import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentStatus } from "@/types/team";

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: "bg-green-500",
  busy: "bg-amber-500 animate-pulse",
  offline: "bg-zinc-500",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Idle",
  busy: "Working",
  offline: "Offline",
};

interface MemberBadgeProps {
  name: string;
  status: AgentStatus;
  currentTaskTitle?: string;
}

export function MemberBadge({ name, status, currentTaskTitle }: MemberBadgeProps) {
  const initials = name
    .split("-")
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 bg-muted/30">
            <div className="relative shrink-0">
              <Avatar className="size-6">
                <AvatarFallback className="text-[10px] bg-muted">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div
                className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-card ${STATUS_COLORS[status]}`}
              />
            </div>
            <div className="min-w-0">
              <span className="text-xs font-medium block truncate">{name}</span>
              {currentTaskTitle ? (
                <span className="text-[10px] text-muted-foreground block truncate max-w-[150px]">
                  {currentTaskTitle}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground block">
                  {STATUS_LABELS[status]}
                </span>
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{name}</p>
          <p className="text-xs text-muted-foreground capitalize">{status}</p>
          {currentTaskTitle && (
            <p className="text-xs text-muted-foreground">Working on: {currentTaskTitle}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
