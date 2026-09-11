export type LocalPromptType = 1 | 2;

export interface LocalPromptRecord {
  id?: string;
  title: string;
  content: string;
  type: LocalPromptType;
  source?: string;
}

export interface PromptGalleryItem {
  id: string;
  title: string;
  content: string;
  images: string[];
  tags: string[];
  contributor: string;
  notes: string;
  source: string;        // 数据源标识（如 "local", "nanobanana", "gpt-image-2"）
  sourceUrl?: string;    // 来源链接（GitHub链接）
  category?: string;     // 分类
  localType?: LocalPromptType;
}

export interface PromptGallerySection {
  id: string;
  title: string;
  isCollapsed: boolean;
  prompts: PromptGalleryItem[];
}

export interface PromptGalleryData {
  sections: PromptGallerySection[];
}
