export type Suit = 'S' | 'H' | 'C' | 'D';
export interface CardSpec { rank?: string; suit?: Suit; joker?: 'big' | 'small'; id?: string; group?: string }
export interface HandOptions { groupKey?: (c: CardSpec) => string; lang?: 'zh' | 'en'; wide?: boolean; viewportHeight?: number; wheel?: HTMLInputElement; onChange?: (ids: string[]) => void; onPlay?: (ids: string[]) => void }
export interface HandController { redraw(): void; scrollTo(p: number): void; selected(): string[]; select(ids: string[]): void; clear(): void }
export interface LiuliuApi {
  card(spec: CardSpec, opt?: { width?: number; pts?: number; lang?: 'zh' | 'en' }): HTMLElement;
  split(cards: CardSpec[], groupKey: (c: CardSpec) => string): [CardSpec[], CardSpec[]];
  handPlan(cards: CardSpec[], o: { width: number; height: number; viewportHeight?: number; groupKey?: (c: CardSpec) => string; wide?: boolean }): object;
  renderHand(area: HTMLElement, cards: CardSpec[], o?: HandOptions): HandController;
  leoIdle(img: HTMLImageElement, src: Record<string, string>, o?: { groomAt?: number; yawnAt?: number; sleepAt?: number }): { show(k: string): void; wake(): void; stop(): void };
}
declare global { interface Window { Liuliu: LiuliuApi } }
