/** 广场搜索只读这些字段；style/scene 等展示轴不参与匹配。 */
export type PromptGallerySearchable = {
  title?: string | null;
  content?: string | null;
  contributor?: string | null;
  notes?: string | null;
  tags?: readonly string[] | null;
};

export function matchesPromptGalleryQuery(
  prompt: PromptGallerySearchable,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    prompt.title,
    prompt.content,
    prompt.contributor,
    prompt.notes,
    ...(prompt.tags ?? []),
  ];

  return haystack.some((value) => (value ?? '').toLowerCase().includes(needle));
}
