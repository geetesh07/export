declare module 'dxf-writer' {
  export default class Drawing {
    constructor();
    addLayer(name: string, colorIndex: number, lineType: string): void;
    drawText(x: number, y: number, height: number, text: string, rotation?: number, horizontalAlignment?: number, verticalAlignment?: number): void;
    drawLine(x1: number, y1: number, x2: number, y2: number): void;
    toDxfString(): string;
  }

  export namespace Drawing {
    export namespace ACI {
      export const RED: number;
      export const GREEN: number;
      export const BLUE: number;
    }
  }
} 