import { formatDistanceToNow } from "date-fns";
import { GitBranch, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { PRIORITY_CONFIG, COLUMNS, TASK_TYPE_CONFIG } from "@/lib/constants";
import { CommentThread } from "./CommentThread";
import { FileContextList } from "./FileContextList";
import { TaskRefList } from "./TaskRefList";
import type { Task, FileContext, RefType } from "@/types/board";

interface TaskDetailSheetProps {
  task: Task | null;
  allTasks: Task[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddComment: (taskId: string, text: string) => void;
  onUpdateContext: (taskId: string, files: FileContext[]) => void;
  onAddRef: (taskId: string, targetId: string, type: RefType) => void;
  onRemoveRef: (taskId: string, targetId: string) => void;
  onDelete: (id: string) => void;
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
  onDelete,
}: TaskDetailSheetProps) {
  if (!task) return null;

  const priority = PRIORITY_CONFIG[task.priority];
  const column = COLUMNS.find((c) => c.id === task.column);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left pr-6">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            Created {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
            {" · "}Updated{" "}
            {formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true })}
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
            <Badge variant="outline" className={`text-xs ${TASK_TYPE_CONFIG[task.type]?.color ?? ""}`}>
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
          {task.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
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
          </TabsList>
          <TabsContent value="description" className="mt-4">
            {task.description ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {task.description}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                No description
              </p>
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
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
