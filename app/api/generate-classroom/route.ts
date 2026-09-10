import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { resolveOwnerId } from '@/lib/contracts/owner';
import { createClassroomJob } from '@/lib/generation/classroom-job-store';
import { runClassroomJob } from '@/lib/generation/classroom-job-runner';

// A full topic-to-course generation run (outline + every scene's content and
// actions, each its own Bedrock call) can run well past a typical serverless
// request/response window. This route only creates the job row and returns;
// the actual work continues in `after()`, bounded by this route's
// maxDuration rather than the client's connection.
//
// Vercel plan tiers cap this differently (roughly 10-60s on lower tiers, up
// to several hundred seconds on higher tiers/Fluid compute) — set this to
// the highest value your deployment plan allows.
export const maxDuration = 300;

interface GenerateClassroomBody {
  requirement?: string;
  pdfContent?: { text: string };
}

export async function POST(request: Request) {
  let body: GenerateClassroomBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const requirement = body.requirement?.trim();
  if (!requirement) {
    return NextResponse.json({ error: '"requirement" is required' }, { status: 400 });
  }

  let ownerId: string;
  try {
    ownerId = resolveOwnerId();
  } catch {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const job = await createClassroomJob(ownerId);

  after(() =>
    runClassroomJob(job.id, {
      requirement,
      pdfContent: body.pdfContent,
      ownerId,
    }),
  );

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
