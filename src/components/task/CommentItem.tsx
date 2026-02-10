import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Comment } from "@/types/board";

interface CommentItemProps {
  comment: Comment;
}

export function CommentItem({ comment }: CommentItemProps) {
  const initials = comment.author
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex gap-3">
      <Avatar className="size-7 shrink-0">
        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{comment.author}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.timestamp), { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
          {comment.text}
        </p>
      </div>
    </div>
  );
}
