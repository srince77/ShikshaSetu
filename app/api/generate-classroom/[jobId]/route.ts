import { NextResponse } from 'next/server';
import { resolveOwnerId } from '@/lib/contracts/owner';
import { getClassroomJob } from '@/lib/generation/classroom-job-store';

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  let ownerId: string;
  try {
    ownerId = resolveOwnerId();
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const job = await getClassroomJob(jobId);
  if (!job || job.ownerId !== ownerId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json(job);
}
