export interface CreativeView {
  ok: boolean; detail: string; managed: boolean; folder: string;
  owned?: boolean; ownedFolder?: string; setupSource?: string; install?: CreativeInstall; supported?: boolean;
  recipes: { id: string; name: string; kind: string; guide: string; license: string; note: string; missing: string[] }[];
}
export interface CreativeInstall {
  phase: 'idle' | 'checking' | 'copying' | 'downloading' | 'extracting' | 'done' | 'error' | 'cancelled';
  detail: string; completed: number; total: number;
}
