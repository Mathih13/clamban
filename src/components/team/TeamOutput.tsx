import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal, Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api-client";

interface TeamOutputProps {
  running: boolean;
}

export function TeamOutput({ running }: TeamOutputProps) {
  const [content, setContent] = useState("");
  const [paused, setPaused] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string>("lead");
  const [workerNames, setWorkerNames] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevContentLenRef = useRef(0);

  // Poll for available worker logs
  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await api.getWorkerLogNames();
        if (mounted) setWorkerNames(res.workers);
      } catch {}
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const fetchLogs = useCallback(async () => {
    if (paused) return;
    try {
      const res = selectedAgent === "lead"
        ? await api.getTeamLogs(500)
        : await api.getWorkerLog(selectedAgent, 500);
      setContent(res.content);
    } catch {}
  }, [paused, selectedAgent]);

  // Poll for log updates
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (paused) return;
    if (content.length > prevContentLenRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevContentLenRef.current = content.length;
  }, [content, paused]);

  // Reset scroll tracking when switching agents
  useEffect(() => {
    prevContentLenRef.current = 0;
  }, [selectedAgent]);

  return (
    <div className="flex flex-col border-t bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal className="size-3.5 text-zinc-500" />
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setSelectedAgent("lead")}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                selectedAgent === "lead"
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-400"
              }`}
            >
              Team Lead
            </button>
            {workerNames.map((name) => (
              <button
                key={name}
                onClick={() => setSelectedAgent(name)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  selectedAgent === name
                    ? "bg-zinc-800 text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-400"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {running && (
            <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => setPaused((p) => !p)}
            title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
          >
            {paused ? (
              <Play className="size-3 text-zinc-500" />
            ) : (
              <Pause className="size-3 text-zinc-500" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6"
            onClick={() => { setContent(""); prevContentLenRef.current = 0; }}
            title="Clear display"
          >
            <Trash2 className="size-3 text-zinc-500" />
          </Button>
        </div>
      </div>
      <ScrollArea className="h-56" ref={scrollRef}>
        <pre className="p-3 text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
          {content || (
            <span className="text-zinc-600">
              {selectedAgent === "lead"
                ? (running ? "Waiting for output..." : "No output yet. Start the team to see logs.")
                : `No logs yet for ${selectedAgent}.`}
            </span>
          )}
          <div ref={bottomRef} />
        </pre>
      </ScrollArea>
    </div>
  );
}
