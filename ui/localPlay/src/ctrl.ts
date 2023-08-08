import { LocalPlayOpts } from './interfaces';
import { makeRounds } from './data';
import { makeFen /*, parseFen*/ } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { Chess } from 'chessops';
import * as Chops from 'chessops';

export class Ctrl {
  path = '';
  chess = Chess.default();
  tellRound: SocketSend;
  fiftyMovePly = 0;
  threefoldFens: Map<string, number> = new Map();

  constructor(readonly opts: LocalPlayOpts, readonly redraw: () => void) {
    makeRounds(this).then(sender => (this.tellRound = sender));
  }

  set(/*fen: string*/) {
    this.fiftyMovePly = 0;
    this.threefoldFens.clear();
    this.chess.reset();
  }

  checkGameOver(userEnd?: 'whiteResign' | 'blackResign' | 'mutualDraw'): {
    end: boolean;
    result?: string;
    reason?: string;
  } {
    let result = 'draw',
      reason = userEnd ?? 'checkmate';
    if (this.chess.isCheckmate()) result = Chops.opposite(this.chess.turn);
    else if (this.chess.isInsufficientMaterial()) reason = 'insufficient';
    else if (this.chess.isStalemate()) reason = 'stalemate';
    else if (this.fifty()) reason = 'fifty';
    else if (this.threefold()) reason = 'threefold';
    else if (userEnd) {
      if (userEnd !== 'mutualDraw') reason = 'resign';
      if (userEnd === 'whiteResign') result = 'black';
      else if (userEnd === 'blackResign') result = 'white';
    } else return { end: false };
    return { end: true, result, reason };
  }

  doGameOver(result: string, reason: string) {
    console.log(`game over ${result} ${reason}`);

    // blah blah do outcome stuff
  }

  move(uci: Uci) {
    const move = Chops.parseUci(uci);
    if (!move || !this.chess.isLegal(move)) throw new Error(`illegal move ${uci}, ${this.fen}}`);
    const san = makeSanAndPlay(this.chess, move);
    this.fifty(move);
    this.threefold('update');
    const { end, result, reason } = this.checkGameOver();
    if (end) this.doGameOver(result!, reason!);

    this.tellRound('move', { uci, san, fen: this.fen, ply: this.ply, dests: this.dests });
  }

  userMove(uci: Uci) {
    this.move(uci);
    this.botMove();
  }

  async botMove() {
    const uci = (await this.zf!.goFish(this.fen, { depth: 10 }))[0].moves[0];
    this.move(uci);
  }

  fifty(move?: Chops.Move) {
    if (move)
      if (!('from' in move) || this.chess.board.getRole(move.from) === 'pawn' || this.chess.board.get(move.to))
        this.fiftyMovePly = 0;
      else this.fiftyMovePly++;
    return this.fiftyMovePly >= 100;
  }

  threefold(update: 'update' | false = false) {
    const boardFen = this.fen.split('-')[0];
    const fenCount = (this.threefoldFens.get(boardFen) ?? 0) + 1;
    if (update) this.threefoldFens.set(boardFen, fenCount);
    return fenCount >= 3;
  }

  isPromotion(move: Chops.Move) {
    return (
      'from' in move &&
      Chops.squareRank(move.to) === (this.chess.turn === 'white' ? 7 : 0) &&
      this.chess.board.getRole(move.from) === 'pawn'
    );
  }

  get dests() {
    const dests: { [from: string]: string } = {};
    [...this.chess.allDests()]
      .filter(([, to]) => !to.isEmpty())
      .forEach(([s, ds]) => (dests[Chops.makeSquare(s)] = [...ds].map(Chops.makeSquare).join('')));
    return dests;
  }

  get fen() {
    return makeFen(this.chess.toSetup());
  }

  get ply() {
    return 2 * (this.chess.fullmoves - 1) + (this.chess.turn === 'black' ? 1 : 0);
  }
}

function linesWithin(move: string, lines: PV[], bias = 0, threshold = 50) {
  const zeroScore = lines.find(line => line.moves[0] === move)?.score ?? Number.NaN;
  return lines.filter(fish => Math.abs(fish.score - bias - zeroScore) < threshold && fish.moves.length);
}

function randomSprinkle(move: string, lines: PV[]) {
  lines = linesWithin(move, lines, 0, 20);
  if (!lines.length) return move;
  return lines[Math.floor(Math.random() * lines.length)].moves[0] ?? move;
}

/*
function occurs(chance: number) {
  return Math.random() < chance;
}*/
