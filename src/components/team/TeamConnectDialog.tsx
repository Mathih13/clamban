import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";

interface TeamConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: {
    teamName: string;
    projectDir: string;
    model?: string;
    maxTurns?: number;
  }) => void;
}

export function TeamConnectDialog({
  open,
  onOpenChange,
  onConnect,
}: TeamConnectDialogProps) {
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [projectDir, setProjectDir] = useState("");
  const [model, setModel] = useState("sonnet");

  useEffect(() => {
    if (open) {
      api.getAvailableTeams().then((res) => {
        setAvailableTeams(res.teams);
        if (res.teams.length > 0 && !teamName) {
          setTeamName(res.teams[0]);
        }
      });
    }
  }, [open, teamName]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim() || !projectDir.trim()) return;
    onConnect({ teamName: teamName.trim(), projectDir: projectDir.trim(), model });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect Team</DialogTitle>
            <DialogDescription>
              Link a Claude Code team to this board.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="teamName">Team Name</Label>
              {availableTeams.length > 0 ? (
                <Select value={teamName} onValueChange={setTeamName}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a team..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTeams.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="teamName"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="my-project-team"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="projectDir">Project Directory</Label>
              <Input
                id="projectDir"
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>
            <div className="grid gap-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opus">Opus</SelectItem>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                  <SelectItem value="haiku">Haiku</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              disabled={!teamName.trim() || !projectDir.trim()}
            >
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
