# Chess Screenshot Analyzer

A local chess analysis tool: paste an image of a position, check the recognized board, and see Stockfish's best moves and variations. Screenshot recognition and engine analysis run on your machine.

## Features

- Paste with **Ctrl+V**, drag an image, or choose a file.
- Local board recognition using Fenshot's ONNX model, including tightly cropped textured boards.
- Default side to move follows the pieces at the bottom; turn and orientation remain editable.
- Drag pieces or click a source and destination to play legal moves and recalculate.
- Separate White and Black castling checkboxes for king-side and queen-side rights. Initial rights are guessed from king and rook starting squares, can be edited, and update as moves are played.
- Live Stockfish analysis with up to four variations, adjustable thinking time, SAN moves, and scores from White's perspective.
- Click a variation move to preview it, then play a continuation to analyze that position.
- Undo, reset, promotion choices, and FEN import/export.
- A **Preload for fastest results** button warms the recognition model, runtime, board assets, and Stockfish's built-in neural network.

Screenshots cannot reveal whether a king or rook moved earlier, or the previous move needed for en passant. Correct the castling checkboxes or supply a full FEN when necessary. The app rejects illegal moves and invalid positions before sending them to Stockfish.

## Requirements

- Node.js 22.12 or newer.
- pnpm or npm.
- A native [Stockfish](https://stockfishchess.org/download/) executable for your operating system.

Stockfish uses the CPU. A GPU, API key, paid service, or cloud inference account is not required. The current settings use 12 threads, 1,024 MB of hash memory, full strength, and up to four principal variations; these are set in `engine.mjs`.

## Install and run

```sh
git clone https://github.com/unworthyzeus/chess-screenshot-analyzer.git
cd chess-screenshot-analyzer
pnpm install --frozen-lockfile
pnpm run build
```

The build prepares the WASM runtime and piece graphics from installed dependencies. The recognition model is bundled by Vite from the Fenshot package. Generated assets and native executables are excluded from Git.

Set `STOCKFISH_PATH` to your engine executable, then start the server. In PowerShell:

```powershell
$env:STOCKFISH_PATH = 'C:\path\to\stockfish.exe'
pnpm start
```

On macOS or Linux:

```sh
STOCKFISH_PATH=/path/to/stockfish pnpm start
```

On macOS/Linux, `stockfish` on `PATH` is also supported. The original Windows installation is detected automatically when the engine exists at `../Stockfish-19/stockfish/stockfish-windows-x86-64-universal.exe`, relative to this project.

Open **http://127.0.0.1:8765/**. Click **Preload for fastest results**, then paste a board image. First results appear during the search; five seconds is the default thinking time.

The server binds to localhost. `CHESS_ANALYSIS_PORT` changes the port if needed. Set environment variables in your shell; the app does not automatically load `.env` files.

You can use `npm install`, `npm run build`, and `npm start` instead of pnpm. The committed pnpm lockfile provides the reproducible dependency versions.

## Checks

```sh
pnpm test
pnpm run build
```

The tests cover orientation, invalid positions, SAN/score conversion, legal moves, castling and rook captures, en passant, promotion, preloading, live MultiPV analysis, cancellation, and positions with fewer than four legal replies. The integration test needs a working Stockfish installation configured as above.

The textured screenshot that originally exposed a recognition failure is retained in `tests/fixtures/` as a regression fixture.

## Project layout

- `src/App.tsx`: screenshot input, position controls, analysis, previews, and move history.
- `src/Board.tsx`: interactive cm-chessboard board.
- `src/recognizer.ts`: local ONNX recognition and cropped-board fallback.
- `server.mjs`: localhost API and static frontend server.
- `engine.mjs`: persistent Stockfish process, warmup, and streaming searches.
- `shared.mjs`: FEN validation, orientation, legal moves, and UCI parsing.
- `scripts/prepare-assets.mjs`: reproducible browser runtime and graphics preparation.

## Third-party components

The interface, recognition pipeline, and model build on [Fenshot](https://github.com/scoriiu/fenshot), with its MIT notice in `FENSHOT-LICENSE`. The project also uses [cm-chessboard](https://github.com/shaack/cm-chessboard), [chess.js](https://github.com/jhlywa/chess.js), [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), and React. Their license notices remain with the installed packages.

Stockfish is installed separately and is not redistributed in this repository. Node.js binaries, build output, dependency folders, server logs, and local engine configuration are excluded.
