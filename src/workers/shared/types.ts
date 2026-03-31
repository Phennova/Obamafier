/** Messages from main thread to assignment worker */
export interface AssignmentWorkerInput {
  type: 'compute';
  sourceRGBA: number[];
  targetRGBA: number[];
  width: number;
  height: number;
  swapIterations: number;
}

/** Messages from assignment worker to main thread */
export interface AssignmentWorkerOutput {
  type: 'progress' | 'result';
  phase?: string;
  progress?: number;
  message?: string;
  /** Flat array: assignment[sourceIdx] = targetIdx */
  assignment?: number[];
  totalCost?: number;
}

/** Messages from main thread to refinement worker */
export interface RefinementWorkerInput {
  type: 'refine';
  assignment: number[];
  sourceLabColors: number[];
  targetLabColors: number[];
  iterations: number;
  batchSize: number;
}

/** Messages from refinement worker to main thread */
export interface RefinementWorkerOutput {
  type: 'progress' | 'result';
  progress?: number;
  assignment?: number[];
  swapsAccepted?: number;
}
