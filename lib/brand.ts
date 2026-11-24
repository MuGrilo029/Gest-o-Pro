/** Iniciais (até 2 letras) do nome da loja, usadas no logotipo do app mobile. */
export const getBrandInitials = (name: string | null | undefined, fallback = 'Gestão Pro'): string => {
  const base = (name || '').trim() || fallback;
  return base
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => Array.from(word)[0])
    .join('')
    .toUpperCase();
};
