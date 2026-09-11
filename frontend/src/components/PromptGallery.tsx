import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { Search, Loader2, AlertCircle, ExternalLink, ChevronUp, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PromptCard,
  PromptDetailModal,
  PromptGalleryImagePreviewModal,
} from '@/components/prompt-gallery/PromptGallerySubcomponents';
import {
  LocalPromptDeleteDialog,
  LocalPromptFormDialog,
} from '@/components/prompt-gallery/LocalPromptEditor';
import {
  ALL_CATEGORY,
  DEFAULT_CATEGORIES,
  LOCAL_CATEGORY,
  LOCAL_PROMPT_SOURCE_LABEL,
  PROMPT_DATA_SOURCES,
  canEditGalleryPrompt,
  fetchAllPromptSources,
  fetchLocalPromptRecords,
  getPromptSourceLabel,
  isLocalPrompt,
  mapLocalPromptRecords,
  mergePromptGalleryCategories,
  mergePromptGallerySources,
  pinLocalGalleryPrompts,
  writeLocalPrompt,
  type PromptWithKey,
} from '@/lib/prompt-gallery-data';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matchesPromptGalleryQuery } from '@/lib/prompt-gallery-search';
import { seededShuffle } from '@/lib/seeded-shuffle';
import type { LocalPromptType } from '@/lib/prompt-gallery-types';

const PROMPT_GALLERY_STEP = 20;
const PROMPT_GALLERY_WIDE_STEP = 30;

const PromptGallery = memo(function PromptGallery({ wideMode = false }: { wideMode?: boolean }) {
  const pageStep = wideMode ? PROMPT_GALLERY_WIDE_STEP : PROMPT_GALLERY_STEP;
  const [allPrompts, setAllPrompts] = useState<PromptWithKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [detailPrompt, setDetailPrompt] = useState<PromptWithKey | null>(null);
  const [imagePreview, setImagePreview] = useState<{ prompt: PromptWithKey; initialIndex: number } | null>(null);
  const [imageCache, setImageCache] = useState<Set<string>>(new Set());
  const [displayCount, setDisplayCount] = useState(pageStep);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; prompt: PromptWithKey } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptWithKey | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const refreshLocalPrompts = useCallback(async () => {
    const localRecords = await fetchLocalPromptRecords();
    const localPrompts = mapLocalPromptRecords(localRecords);
    setAllPrompts(prev => mergePromptGallerySources(prev, localPrompts));
    setCategories(prev => mergePromptGalleryCategories(prev, localPrompts));
    return localPrompts;
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/nova/blacklist')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.keywords)) {
          setBlacklist(data.keywords.map((keyword: string) => keyword.toLowerCase()));
        }
      })
      .catch(() => {
        if (!cancelled) setBlacklist([]);
      });

    Promise.allSettled([fetchAllPromptSources(), fetchLocalPromptRecords()])
      .then(([remoteResult, localResult]) => {
        if (cancelled) return;
        const remote = remoteResult.status === 'fulfilled'
          ? remoteResult.value
          : { prompts: [] as PromptWithKey[], categories: DEFAULT_CATEGORIES };
        const localRecords = localResult.status === 'fulfilled' ? localResult.value : [];
        const localPrompts = mapLocalPromptRecords(localRecords);
        const merged = mergePromptGallerySources(remote.prompts, localPrompts);
        if (merged.length === 0 && remoteResult.status === 'rejected') {
          setError(remoteResult.reason instanceof Error ? remoteResult.reason.message : '提示词广场加载失败');
        } else {
          setError(null);
          setCategories(mergePromptGalleryCategories(remote.categories, localPrompts));
          setAllPrompts(merged);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleShowDetail = useCallback((prompt: PromptWithKey) => {
    setDetailPrompt(prompt);
  }, []);

  const handleShowImages = useCallback((prompt: PromptWithKey, initialIndex = 0) => {
    setImagePreview({ prompt, initialIndex });
  }, []);

  const handleImageLoad = useCallback((url: string) => {
    setImageCache((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const baseFilteredPrompts = useMemo(() => {
    let prompts = allPrompts;

    if (blacklist.length > 0) {
      prompts = prompts.filter((prompt) => {
        const contentToCheck = [
          prompt.title.toLowerCase(),
          prompt.content.toLowerCase(),
          prompt.contributor?.toLowerCase() || '',
          prompt.notes?.toLowerCase() || '',
          ...prompt.tags.map((tag) => tag.toLowerCase()),
        ].join(' ');

        return !blacklist.some((keyword) => contentToCheck.includes(keyword));
      });
    }

    const hasChinese = (text: string) => /[\u4e00-\u9fa5]/.test(text);
    prompts = prompts.filter((prompt) => (
      isLocalPrompt(prompt) || hasChinese(prompt.title) || hasChinese(prompt.content)
    ));

    if (selectedCategory !== ALL_CATEGORY) {
      prompts = prompts.filter((prompt) => prompt.category === selectedCategory);
    }

    if (searchQuery) {
      prompts = prompts.filter((prompt) => matchesPromptGalleryQuery({
        title: prompt.title,
        content: prompt.content,
        contributor: prompt.contributor,
        notes: prompt.notes,
        tags: prompt.tags,
      }, searchQuery));
    }

    return prompts;
  }, [allPrompts, blacklist, searchQuery, selectedCategory]);

  const filteredPrompts = useMemo(() => {
    const local = baseFilteredPrompts.filter(isLocalPrompt);
    const remote = baseFilteredPrompts.filter((prompt) => !isLocalPrompt(prompt));
    const seed = `${searchQuery}\0${blacklist.join('\0')}\0${remote.map((prompt) => prompt.uniqueKey).join('\0')}`;
    return pinLocalGalleryPrompts([...local, ...seededShuffle(remote, seed)]);
  }, [baseFilteredPrompts, blacklist, searchQuery]);

  const handleWriteError = (message: string, status?: number) => {
    if (status === 403) {
      setWriteError(message || '口令错误或未配置写入口令');
      return;
    }
    setWriteError(message || '写入失败');
  };

  const handleCreateOrEdit = useCallback(async (payload: {
    title: string;
    content: string;
    type: LocalPromptType;
    password: string;
  }) => {
    if (!editor) return;
    setWriting(true);
    setWriteError(null);
    try {
      const result = editor.mode === 'create'
        ? await writeLocalPrompt({ method: 'POST', ...payload })
        : await writeLocalPrompt({ method: 'PUT', id: editor.prompt.id, ...payload });
      if (!result.ok) {
        handleWriteError(result.error || '写入失败', result.status);
        return;
      }
      await refreshLocalPrompts();
      if (editor.mode === 'create') {
        setSearchQuery('');
        setSelectedCategory(LOCAL_CATEGORY);
      }
      setEditor(null);
    } catch (err) {
      handleWriteError(err instanceof Error ? err.message : '写入失败');
    } finally {
      setWriting(false);
    }
  }, [editor, refreshLocalPrompts]);

  const handleDelete = useCallback(async (password: string) => {
    if (!deleteTarget) return;
    setWriting(true);
    setWriteError(null);
    try {
      const result = await writeLocalPrompt({
        method: 'DELETE',
        id: deleteTarget.id,
        password,
      });
      if (!result.ok) {
        handleWriteError(result.error || '删除失败', result.status);
        return;
      }
      await refreshLocalPrompts();
      if (detailPrompt?.uniqueKey === deleteTarget.uniqueKey) setDetailPrompt(null);
      setDeleteTarget(null);
    } catch (err) {
      handleWriteError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setWriting(false);
    }
  }, [deleteTarget, detailPrompt, refreshLocalPrompts]);

  useEffect(() => {
    queueMicrotask(() => setDisplayCount(pageStep));
  }, [pageStep, searchQuery, selectedCategory]);

  useEffect(() => {
    if (!loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayCount < filteredPrompts.length) {
          setDisplayCount((prev) => Math.min(prev + pageStep, filteredPrompts.length));
        }
      },
      { rootMargin: '400px' },
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [displayCount, filteredPrompts.length, pageStep]);

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollTop(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const displayedPrompts = useMemo(() => filteredPrompts.slice(0, displayCount), [displayCount, filteredPrompts]);
  const hasMore = displayCount < filteredPrompts.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="搜索提示词、标题、作者或标签..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              onClick={() => {
                setWriteError(null);
                setEditor({ mode: 'create' });
              }}
              className="flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
              添加模板
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <Badge
                key={category}
                variant={selectedCategory === category ? 'default' : 'secondary'}
                className="cursor-pointer px-3 py-1 transition-colors hover:bg-primary/80"
                onClick={() => setSelectedCategory(category)}
              >
                {category}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            找到 {filteredPrompts.length} 个提示词{displayedPrompts.length < filteredPrompts.length ? ` · 显示 ${displayedPrompts.length} 个` : ''}
          </span>
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
              <span>提示词来源</span>
              <ExternalLink className="w-3 h-3" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">提示词来源（{PROMPT_DATA_SOURCES.length + 1}）</p>
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm">
                  <span className="truncate">{LOCAL_PROMPT_SOURCE_LABEL}</span>
                </div>
                {PROMPT_DATA_SOURCES.map((source) => (
                  <a
                    key={source.name}
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{getPromptSourceLabel(source.sourceUrl)}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${wideMode ? '2xl:grid-cols-5' : ''}`}>
          {displayedPrompts.map((prompt) => (
            <PromptCard
              key={prompt.uniqueKey}
              prompt={prompt}
              onShowDetail={() => handleShowDetail(prompt)}
              onShowImages={(initialIndex) => handleShowImages(prompt, initialIndex)}
              imageCache={imageCache}
              onImageLoad={handleImageLoad}
              onEdit={canEditGalleryPrompt(prompt) ? () => {
                setWriteError(null);
                setEditor({ mode: 'edit', prompt });
              } : undefined}
              onDelete={canEditGalleryPrompt(prompt) ? () => {
                setWriteError(null);
                setDeleteTarget(prompt);
              } : undefined}
            />
          ))}
        </div>

        {hasMore && (
          <div ref={loadMoreRef} className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {filteredPrompts.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            没有找到匹配的提示词
          </div>
        )}
      </div>

      {showScrollTop && (
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
          aria-label="回到顶部"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
      )}

      {detailPrompt && (
        <PromptDetailModal
          prompt={detailPrompt}
          onClose={() => setDetailPrompt(null)}
        />
      )}

      {imagePreview && (
        <PromptGalleryImagePreviewModal
          images={imagePreview.prompt.images}
          title={imagePreview.prompt.title}
          prompt={imagePreview.prompt}
          initialIndex={imagePreview.initialIndex}
          onClose={() => setImagePreview(null)}
        />
      )}

      {editor && (
        <LocalPromptFormDialog
          key={editor.mode === 'edit' ? editor.prompt.uniqueKey : 'create'}
          mode={editor.mode}
          initialTitle={editor.mode === 'edit' ? editor.prompt.title : ''}
          initialContent={editor.mode === 'edit' ? editor.prompt.content : ''}
          initialType={editor.mode === 'edit' ? (editor.prompt.localType || 1) : 1}
          error={writeError}
          submitting={writing}
          onClose={() => {
            if (writing) return;
            setEditor(null);
            setWriteError(null);
          }}
          onSubmit={payload => void handleCreateOrEdit(payload)}
        />
      )}

      {deleteTarget && (
        <LocalPromptDeleteDialog
          promptTitle={deleteTarget.title}
          error={writeError}
          submitting={writing}
          onClose={() => {
            if (writing) return;
            setDeleteTarget(null);
            setWriteError(null);
          }}
          onConfirm={password => void handleDelete(password)}
        />
      )}
    </>
  );
});

export { PromptGallery };
