import { Plus, LayoutDashboard, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onNewTask: () => void;
  taskCount: number;
  teamConnected?: boolean;
  teamRunning?: boolean;
  teamName?: string;
  onTeamClick?: () => void;
}

export function Header({
  onNewTask,
  taskCount,
  teamConnected,
  teamRunning,
  teamName,
  onTeamClick,
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
        {teamConnected ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onTeamClick}
            className="gap-1.5"
          >
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
