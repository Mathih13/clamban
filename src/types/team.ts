export type AgentStatus = "idle" | "busy" | "offline";

export interface TeamMember {
  name: string;
  agentId: string;
  agentType: string;
  model: string;
  status: AgentStatus;
  currentTask?: string;
  joinedAt: number;
}

export interface TeamState {
  name: string;
  leadPid?: number;
  members: TeamMember[];
  startedAt?: string;
  stoppedAt?: string;
  running: boolean;
}

export interface WorkerProcess {
  name: string;
  pid: number;
  taskId: string;
  branch: string;
  worktreePath: string;
  startedAt: string;
  logPath: string;
  lastEventAt: number;
}
