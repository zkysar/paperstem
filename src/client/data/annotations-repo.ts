import type {
  Annotation,
  AnnotationReply,
  ReactionTarget,
} from '../../shared/types';

export type CreateAnnotationInput = {
  start_ms: number;
  end_ms: number | null;
  body: string;
  starred?: boolean;
};

export type PatchAnnotationInput = {
  start_ms?: number;
  end_ms?: number | null;
  body?: string;
  starred?: boolean;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function listAnnotations(
  projectId: string,
): Promise<Annotation[]> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/annotations`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { annotations: Annotation[] };
  return data.annotations;
}

export async function createAnnotation(
  projectId: string,
  input: CreateAnnotationInput,
): Promise<Annotation> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/annotations`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { annotation: Annotation };
  return data.annotation;
}

export async function patchAnnotation(
  id: string,
  input: PatchAnnotationInput,
): Promise<Annotation> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { annotation: Annotation };
  return data.annotation;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const res = await fetch(`/api/annotations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

export async function listReplies(
  annotationId: string,
): Promise<AnnotationReply[]> {
  const res = await fetch(
    `/api/annotations/${encodeURIComponent(annotationId)}/replies`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { replies: AnnotationReply[] };
  return data.replies;
}

export async function createReply(
  annotationId: string,
  body: string,
): Promise<AnnotationReply> {
  const res = await fetch(
    `/api/annotations/${encodeURIComponent(annotationId)}/replies`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { reply: AnnotationReply };
  return data.reply;
}

export async function patchReply(
  id: string,
  body: string,
): Promise<AnnotationReply> {
  const res = await fetch(
    `/api/annotation-replies/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { reply: AnnotationReply };
  return data.reply;
}

export async function deleteReply(id: string): Promise<void> {
  const res = await fetch(
    `/api/annotation-replies/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  );
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}

function reactionUrl(target: ReactionTarget): string {
  return target.kind === 'annotation'
    ? `/api/annotations/${encodeURIComponent(target.id)}/reactions`
    : `/api/annotation-replies/${encodeURIComponent(target.id)}/reactions`;
}

export async function addReaction(
  target: ReactionTarget,
  emoji: string,
): Promise<void> {
  const res = await fetch(reactionUrl(target), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function removeReaction(
  target: ReactionTarget,
  emoji: string,
): Promise<void> {
  const res = await fetch(reactionUrl(target), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok && res.status !== 204) throw new Error(await readError(res));
}
