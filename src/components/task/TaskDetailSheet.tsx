import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { Check, Clock, GitBranch, GitFork, Pencil, Timer, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PRIORITY_CONFIG, COLUMNS, TASK_TYPE_CONFIG } from "@/lib/constants";
import { CommentThread } from "./CommentThread";
import { FileContextList } from "./FileContextList";
import { QuestionThread } from "./QuestionThread";
import { TaskRefList } from "./TaskRefList";
import { ReviewTab } from "@/components/review/ReviewTab";
import type { Task, Budget, FileContext, RefType, RepoConfig } from "@/types/board";

interface TaskDetailSheetProps {
  task: Task | null;
  allTasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddComment: (taskId: string, text: string) => void;
  onUpdateContext: (taskId: string, files: FileContext[]) => void;
  onAddRef: (taskId: string, targetId: string, type: RefType) => void;
  onRemoveRef: (taskId: string, targetId: string) => void;
  onAnswerQuestion: (taskId: string, questionId: string, answer: string) => void;
  onUpdateBudget: (taskId: string, budget: Budget | undefined) => void;
  onMerge: (taskId: string) => void;
  onRequestChanges: (taskId: string, feedback: string) => void;
  onDelete: (id: string) => void;
  availableRepos?: RepoConfig[];
  onUpdateRepo: (taskId: string, repo: string | undefined) => void;
}

export function TaskDetailSheet({
  task,
  allTasks,
  open,
  onOpenChange,
  onAddComment,
  onUpdateContext,
  onAddRef,
  onRemoveRef,
  onAnswerQuestion,
  onUpdateBudget,
  onMerge,
  onRequestChanges,
  onDelete,
  availableRepos,
  onUpdateRepo,
}: TaskDetailSheetProps) {
  const [editingBudget, setEditingBudget] = useState(false);
  const [draftTurns, setDraftTurns] = useState("");
  const [draftMinutes, setDraftMinutes] = useState("");

  if (!task) return null;

  const priority = PRIORITY_CONFIG[task.priority];
  const column = COLUMNS.find((c) => c.id === task.column);

  function startEditBudget() {
    if (!task) return;
    setDraftTurns(task.budget?.turns != null ? String(task.budget.turns) : "");
    setDraftMinutes(
      task.budget?.wallClockMinutes != null ? String(task.budget.wallClockMinutes) : ""
    );
    setEditingBudget(true);
  }

  function saveBudget() {
    if (!task) return;
    const turns = draftTurns.trim() ? parseInt(draftTurns, 10) : NaN;
    const minutes = draftMinutes.trim() ? parseInt(draftMinutes, 10) : NaN;
    const budget: Budget | undefined =
      Number.isFinite(turns) || Number.isFinite(minutes)
        ? {
            turns: Number.isFinite(turns) ? turns : undefined,
            wallClockMinutes: Number.isFinite(minutes) ? minutes : undefined,
          }
        : undefined;
    onUpdateBudget(task.id, budget);
    setEditingBudget(false);
  }

  function cancelBudget() {
    setEditingBudget(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left pr-6">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
            {" · "}Updated {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 px-4 pb-2 flex-wrap">
          <Badge variant="outline">{column?.name}</Badge>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 ml-auto text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(task.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
          {task.type && (
            <Badge
              variant="outline"
              className={`text-xs ${TASK_TYPE_CONFIG[task.type]?.color ?? ""}`}
            >
              {TASK_TYPE_CONFIG[task.type]?.label ?? task.type}
            </Badge>
          )}
          <div className="flex items-center gap-1">
            <div className={`size-2 rounded-full ${priority.dotColor}`} />
            <span className={`text-xs ${priority.color}`}>{priority.label}</span>
          </div>
          {task.assignee && (
            <Badge variant="secondary" className="text-xs gap-1">
              <span className="size-3 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary">
                {task.assignee[0]?.toUpperCase()}
              </span>
              {task.assignee}
            </Badge>
          )}
          {task.branch && (
            <Badge variant="secondary" className="text-xs font-mono gap-1">
              <GitBranch className="size-3" />
              {task.branch}
            </Badge>
          )}
          {availableRepos && availableRepos.length > 1 && (
            <Select
              value={task.repo ?? "_default"}
              onValueChange={(v) => onUpdateRepo(task.id, v === "_default" ? undefined : v)}
            >
              <SelectTrigger className="h-6 text-xs px-2 gap-1 w-auto border-dashed">
                <GitFork className="size-3" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_default">
                  {availableRepos[0].name} (default)
                </SelectItem>
                {availableRepos.slice(1).map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {task.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="flex items-center gap-2 px-4 pb-2 text-xs text-muted-foreground flex-wrap">
          {editingBudget ? (
            <>
              <Timer className="size-3" />
              <Input
                type="number"
                min="1"
                value={draftTurns}
                onChange={(e) => setDraftTurns(e.target.value)}
                placeholder="50"
                className="h-6 w-16 text-xs"
              />
              <span>turns</span>
              <Clock className="size-3" />
              <Input
                type="number"
                min="1"
                value={draftMinutes}
                onChange={(e) => setDraftMinutes(e.target.value)}
                placeholder="30"
                className="h-6 w-16 text-xs"
              />
              <span>min</span>
              <Button size="icon" variant="ghost" className="size-6" onClick={saveBudget}>
                <Check className="size-3.5 text-green-500" />
              </Button>
              <Button size="icon" variant="ghost" className="size-6" onClick={cancelBudget}>
                <X className="size-3.5 text-muted-foreground" />
              </Button>
            </>
          ) : (
            <>
              <Timer className="size-3" />
              <span>{task.budget?.turns ?? 200}t</span>
              <Clock className="size-3 ml-1" />
              <span>{task.budget?.wallClockMinutes ?? 120}m</span>
              {!task.budget && <span className="text-muted-foreground/60 italic">(default)</span>}
              <Button size="icon" variant="ghost" className="size-6" onClick={startEditBudget}>
                <Pencil className="size-3 text-muted-foreground" />
              </Button>
            </>
          )}
        </div>

        <Separator className="my-2" />

        <Tabs defaultValue="description" className="px-4 pb-4">
          <TabsList className="w-full">
            <TabsTrigger value="description" className="flex-1">
              Description
            </TabsTrigger>
            <TabsTrigger value="comments" className="flex-1">
              Comments ({task.comments.length})
            </TabsTrigger>
            <TabsTrigger value="links" className="flex-1">
              Links ({(task.refs ?? []).length})
            </TabsTrigger>
            <TabsTrigger value="context" className="flex-1">
              Files ({task.context.length})
            </TabsTrigger>
            {(task.questions ?? []).length > 0 && (
              <TabsTrigger value="questions" className="flex-1">
                <span
                  className={(task.questions ?? []).some((q) => !q.answer) ? "text-amber-500" : ""}
                >
                  Questions ({(task.questions ?? []).length})
                </span>
              </TabsTrigger>
            )}
            {task.column === "review" && task.branch && (
              <TabsTrigger value="review" className="flex-1 text-green-500">
                Review
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="description" className="mt-4">
            {task.description ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{task.description}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No description</p>
            )}
          </TabsContent>
          <TabsContent value="comments" className="mt-4">
            <CommentThread
              comments={task.comments}
              onAddComment={(text) => onAddComment(task.id, text)}
            />
          </TabsContent>
          <TabsContent value="links" className="mt-4">
            <TaskRefList
              task={task}
              allTasks={allTasks}
              onAddRef={(targetId, type) => onAddRef(task.id, targetId, type)}
              onRemoveRef={(targetId) => onRemoveRef(task.id, targetId)}
            />
          </TabsContent>
          <TabsContent value="context" className="mt-4">
            <FileContextList
              files={task.context}
              onUpdate={(files) => onUpdateContext(task.id, files)}
            />
          </TabsContent>
          {(task.questions ?? []).length > 0 && (
            <TabsContent value="questions" className="mt-4">
              <QuestionThread
                questions={task.questions ?? []}
                onAnswer={(questionId, answer) => onAnswerQuestion(task.id, questionId, answer)}
              />
            </TabsContent>
          )}
          {task.column === "review" && task.branch && (
            <TabsContent value="review" className="mt-4">
              <ReviewTab
                taskId={task.id}
                branch={task.branch}
                comments={task.comments}
                onMerge={onMerge}
                onRequestChanges={onRequestChanges}
              />
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
