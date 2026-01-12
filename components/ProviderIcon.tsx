import React, { useState, memo } from 'react';
import { cn } from '@/lib/utils';

interface ProviderIconProps {
    providerName: string;
    className?: string;
    width?: number;
    height?: number;
}

const PROVIDER_LOGOS: Record<string, string> = {
    'openai': '/providers/openai.svg',
    'claude': '/providers/claude.svg',
    'anthropic': '/providers/claude.svg',
    'gemini': '/providers/gemini.svg',
    'google': '/providers/gemini.svg',
    'vertexai': '/providers/vertexai.svg',
    'vertex': '/providers/vertex.svg',
    'deepseek': '/providers/deepseek.png',
    'moonshot': '/providers/moonshot.png',
    'zhipu': '/providers/zhipu.png',
    'aliyun': '/providers/alibabacloud.png',
    'alibabacloud': '/providers/alibabacloud.png',
    'siliconflow': '/providers/siliconflow.svg',
    'tei': '/providers/tei.svg',
    'transformers': '/providers/transformers.svg',
    'baichuan': '/providers/baichuan.png',
    'volcengine': '/providers/volcengine.png',
    'stepfun': '/providers/stepfun.png',
};

const DARK_INVERT_PROVIDERS = new Set(['openai', 'vertex', 'vertexai', 'siliconflow']);

export const ProviderIcon = memo(function ProviderIcon({
    providerName,
    className,
    width = 24,
    height = 24
}: ProviderIconProps) {
    const [imgError, setImgError] = useState(false);

    const normalizedName = providerName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const logoSrc = PROVIDER_LOGOS[normalizedName];
    const isDarkInvert = DARK_INVERT_PROVIDERS.has(normalizedName);

    if (logoSrc && !imgError) {
        return (
            <img
                src={logoSrc}
                alt=""
                width={width}
                height={height}
                loading="lazy"
                className={cn("object-contain shrink-0", isDarkInvert && "dark:invert", className)}
                onError={() => setImgError(true)}
            />
        );
    }

    return (
        <span
            className={cn(
                "rounded bg-muted flex items-center justify-center text-[8px] font-bold shrink-0",
                className
            )}
            style={{ width, height }}
        >
            {providerName.substring(0, 2).toUpperCase()}
        </span>
    );
})
