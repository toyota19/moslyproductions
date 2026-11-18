declare module 'qrcode/lib/core/qrcode.js' {
  interface QRBitMatrix {
    size: number;
    get(row: number, col: number): boolean | number;
  }
  interface QRCodeInstance {
    modules: QRBitMatrix;
  }
  const QRCore: {
    create(
      data: string,
      options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
    ): QRCodeInstance;
  };
  export default QRCore;
}
