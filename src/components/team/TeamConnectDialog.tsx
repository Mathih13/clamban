import { useState, useEffect } from "react";
import { X } from "lucide-react";
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
import type { RepoConfig, Validation } from "@/types/board";

interface TeamConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: {
    teamName: string;
    repos: RepoConfig[];
    model?: string;
    workerModel?: string;
    maxTurns?: number;
    validation?: Validation;
    codeRabbit?: boolean;
  }) => void;
}

export function TeamConnectDialog({ open, onOpenChange, onConnect }: TeamConnectDialogProps) {
  const [availableTeams, setAvailableTeams] = useState<string[]>([]);
  const [teamName, setTeamName] = useState("");
  const [repos, setRepos] = useState<Array<{ name: string; path: string }>>([
    { name: "", path: "" },
  ]);
  const [model, setModel] = useState("haiku");
  const [workerModel, setWorkerModel] = useState("sonnet");
  const [codeRabbit, setCodeRabbit] = useState(false);
  const [buildCommand, setBuildCommand] = useState("");
  const [testCommand, setTestCommand] = useState("");
  const [typecheckCommand, setTypecheckCommand] = useState("");
  const [lintCommand, setLintCommand] = useState("");

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
    const validRepos = repos.filter((r) => r.name.trim() && r.path.trim());
    if (!teamName.trim() || validRepos.length === 0) return;

    const validation: Validation = {};
    if (buildCommand.trim()) validation.build = buildCommand.trim();
    if (testCommand.trim()) validation.test = testCommand.trim();
    if (typecheckCommand.trim()) validation.typecheck = typecheckCommand.trim();
    if (lintCommand.trim()) validation.lint = lintCommand.trim();
    const hasAnyValidation = Object.keys(validation).length > 0;

    onConnect({
      teamName: teamName.trim(),
      repos: validRepos.map((r) => ({ name: r.name.trim(), path: r.path.trim() })),
      model,
      workerModel,
      validation: hasAnyValidation ? validation : undefined,
      codeRabbit,
    });
    onOpenChange(false);
  }

  const hasValidRepo = repos.some((r) => r.name.trim() && r.path.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect Team</DialogTitle>
            <DialogDescription>Link a Claude Code team to this board.</DialogDescription>
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
              <div className="flex items-center justify-between">
                <Label>Repos</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setRepos((p) => [...p, { name: "", path: "" }])}
                >
                  + Add
                </Button>
              </div>
              {repos.map((repo, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={repo.name}
                    placeholder={i === 0 ? "frontend" : "backend"}
                    className="w-28"
                    onChange={(e) =>
                      setRepos((p) =>
                        p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))
                      )
                    }
                  />
                  <Input
                    value={repo.path}
                    placeholder="/path/to/repo"
                    className="flex-1"
                    onChange={(e) =>
                      setRepos((p) =>
                        p.map((r, j) => (j === i ? { ...r, path: e.target.value } : r))
                      )
                    }
                  />
                  {repos.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0"
                      onClick={() => setRepos((p) => p.filter((_, j) => j !== i))}
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">First repo is the default.</p>
            </div>
            <div className="grid gap-2">
              <Label>Lead Model</Label>
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
            <div className="grid gap-2">
              <Label>Worker Model</Label>
              <Select value={workerModel} onValueChange={setWorkerModel}>
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
            <div className="flex items-center gap-2">
              <input
                id="codeRabbit"
                type="checkbox"
                checked={codeRabbit}
                onChange={(e) => setCodeRabbit(e.target.checked)}
                className="size-4"
              />
              <Label htmlFor="codeRabbit" className="font-normal cursor-pointer">
                Enable CodeRabbit review
              </Label>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Validation Commands (optional)
              </Label>
              <Input
                value={buildCommand}
                onChange={(e) => setBuildCommand(e.target.value)}
                placeholder="Build:  bun run build"
              />
              <Input
                value={testCommand}
                onChange={(e) => setTestCommand(e.target.value)}
                placeholder="Test:  bun test"
              />
              <Input
                value={typecheckCommand}
                onChange={(e) => setTypecheckCommand(e.target.value)}
                placeholder="Typecheck:  bunx tsc --noEmit"
              />
              <Input
                value={lintCommand}
                onChange={(e) => setLintCommand(e.target.value)}
                placeholder="Lint:  bun run lint"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!teamName.trim() || !hasValidRepo}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
