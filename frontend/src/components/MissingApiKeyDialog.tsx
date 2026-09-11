'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useEmbedRuntime } from '@/hooks/useEmbedRuntime';

interface MissingApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigure: () => void;
}

export function MissingApiKeyDialog({ open, onOpenChange, onConfigure }: MissingApiKeyDialogProps) {
  const embed = useEmbedRuntime();
  const handleConfigure = () => {
    onOpenChange(false);
    onConfigure();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{embed.enabled ? '父站未提供密钥' : '请先配置 API 密钥'}</DialogTitle>
          <DialogDescription>
            {embed.enabled
              ? '嵌入模式下密钥由 Sub2API 父页注入，不会要求你填写 OpenAI Key 或登录第二套账号。请确认父站已选择可用的生图/文本密钥。'
              : 'Nova 模式需要先配置 API 密钥，配置完成后即可生成或转换图片。'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {embed.enabled ? '知道了' : '取消'}
          </Button>
          {!embed.enabled && (
            <Button onClick={handleConfigure}>
              配置
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
