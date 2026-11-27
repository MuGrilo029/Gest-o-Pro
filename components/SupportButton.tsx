import React from 'react';
import { MessageCircle } from 'lucide-react';
import { useStore } from '../contexts/StoreContext';
import { supportWhatsappUrl } from '../lib/support';

/** Botão de suporte via WhatsApp. Sem número configurado, não aparece (decisão 58). */
export const SupportButton: React.FC<{ className?: string; compact?: boolean }> = ({ className = '', compact }) => {
  const { activeStore } = useStore();
  const url = supportWhatsappUrl(undefined, activeStore?.name);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com o suporte pelo WhatsApp"
      title="Suporte pelo WhatsApp"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors ${className}`}
    >
      <MessageCircle size={15} aria-hidden="true" />
      {!compact && <span className="hidden sm:inline">Suporte</span>}
    </a>
  );
};
