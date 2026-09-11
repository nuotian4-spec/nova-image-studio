'use client';

interface EmbedCapabilityNoticeProps {
  kind: 'waiting' | 'image' | 'text';
}

const MESSAGES: Record<EmbedCapabilityNoticeProps['kind'], string> = {
  waiting: '正在等待父站注入站点密钥。嵌入模式下不会要求你登录第二套账号或填写 OpenAI Key。',
  image: '父站未提供生图密钥，生图工作台已禁用。请在 Sub2API 账户中配置可用的生图 Key。',
  text: '父站未提供文本密钥，Agent / 反推 / 切图 AI / 网页复刻已禁用。请在 Sub2API 账户中配置可用的文本 Key。',
};

export function EmbedCapabilityNotice({ kind }: EmbedCapabilityNoticeProps) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
      {MESSAGES[kind]}
    </div>
  );
}
