import { GitPullRequest, LayoutDashboard, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  onNewTask: () => void;
  taskCount: number;
  teamConnected?: boolean;
  teamRunning?: boolean;
  teamName?: string;
  reviewCount?: number;
  onTeamClick?: () => void;
  onReviewClick?: () => void;
}

export function Header({
  onNewTask,
  taskCount,
  teamConnected,
  teamRunning,
  teamName,
  reviewCount = 0,
  onTeamClick,
  onReviewClick,
}: HeaderProps) {
  return (
    <header className="border-b bg-card px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Clamban</h1>
        <span className="text-sm text-muted-foreground">
          {taskCount} task{taskCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {reviewCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReviewClick}
            className="gap-1.5 text-green-500"
          >
            <GitPullRequest className="size-4" />
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 bg-green-500/20 text-green-500"
            >
              {reviewCount}
            </Badge>
          </Button>
        )}
        {teamConnected ? (
          <Button size="sm" variant="ghost" onClick={onTeamClick} className="gap-1.5">
            <div className="relative">
              <Users className="size-4" />
              <div
                className={`absolute -top-0.5 -right-0.5 size-2 rounded-full border border-card ${
                  teamRunning ? "bg-green-500" : "bg-zinc-500"
                }`}
              />
            </div>
            <span className="text-xs">{teamName}</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onTeamClick}>
            <Users className="size-4" />
            Team
          </Button>
        )}
        <Button size="sm" onClick={onNewTask}>
          <Plus />
          New Task
        </Button>
      </div>
    </header>
  );
}
