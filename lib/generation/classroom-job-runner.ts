/**
 * Runs one classroom-generation job to completion, reporting progress into
 * the DB-tracked job row as it goes. Invoked from the background (via
 * Next.js `after()`) by the generate-classroom route after it has already
 * responded with the job id.
 */

import { generateClassroom, type GenerateClassroomInput } from './classroom-generation';
import {
  completeClassroomJob,
  failClassroomJob,
  updateClassroomJobProgress,
} from './classroom-job-store';

export async function runClassroomJob(jobId: string, input: GenerateClassroomInput): Promise<void> {
  await updateClassroomJobProgress(jobId, { status: 'running', step: 'initializing', progress: 1 });

  try {
    const result = await generateClassroom(input, {
      onProgress: async (progress) => {
        await updateClassroomJobProgress(jobId, {
          status: 'running',
          step: progress.step,
          progress: progress.progress,
          message: progress.message,
          scenesGenerated: progress.scenesGenerated,
          totalScenes: progress.totalScenes,
        });
      },
    });

    await completeClassroomJob(
      jobId,
      { id: result.id, scenesCount: result.scenesCount, createdAt: result.createdAt },
      result.id,
    );
  } catch (error) {
    console.error(`[ClassroomJobRunner] job ${jobId} failed:`, error);
    await failClassroomJob(jobId, error instanceof Error ? error.message : String(error));
  }
}
