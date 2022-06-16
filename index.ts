import WebSocket, { WebSocketServer } from "ws";
import { v4 } from "uuid";
import express from "express";
import names from "./names.json";
import adjectives from "./adjectives.json";
import questions from "./questions";
import leven from "./leven";

type Options = {
  maxScore?: number;
  criteria?: number;
  prefix?: string;
};

interface Player {
  clientId: string;
  name: string;
  score: number;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function capitalizeFirstLetter(str: string) {
  const capitalized = str.charAt(0).toUpperCase() + str.slice(1);
  return capitalized;
}

function randomName() {
  const name = `${names[Math.floor(Math.random() * names.length)]}`;
  const adjective = `${
    adjectives[Math.floor(Math.random() * adjectives.length)]
  }`;
  return `${capitalizeFirstLetter(adjective)}${capitalizeFirstLetter(
    name
  )}${Math.floor(Math.random() * 20)}`;
}

function generateGameCode() {
  let result = "";
  const codeLength = 6;
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const charactersLength = characters.length;
  for (var i = 0; i < codeLength; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

function shuffle(arr: any[]) {
  const shuffled = arr;
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
function findSimilar(
  word: string,
  candidates: readonly string[] | string[],
  options: Options = {}
) {
  let { maxScore = 3 } = options;
  const { criteria = 0.5, prefix = "" } = options;

  const matches = [];
  for (const candidate of candidates) {
    const length = Math.max(word.length, candidate.length);
    const score = leven(word, candidate);
    const similarity = (length - score) / length;

    if (similarity >= criteria && score <= maxScore) {
      if (score < maxScore) {
        maxScore = score;
        matches.length = 0;
      }

      matches.push(prefix + candidate);
    }
  }

  return matches;
}

function sendToGamePlayers(game, data, playersFilter = (e) => e) {
  for (let index = 0; index < game.players.length; index++) {
    const player = Object.values(clients).find(
      (cl) => cl.clientId === game.players[index].clientId
    );

    player?.connection?.send?.(
      JSON.stringify({
        ...data,
        game,
      })
    );
  }
}

async function sendQuestion(
  game,
  question,
  questionTime,
  timeUntilNextQuestion
) {
  return new Promise(async (resolve, reject) => {
    game.currentRound.roundNumber += 1;
    game.currentRound.roundScores = {};
    guesses[game.id] = [];
    sendToGamePlayers(game, {
      method: "question",
      question: question.title,
    });

    game.question = question.title;
    await sleep(questionTime + 5000);

    sendToGamePlayers(game, {
      method: "question end",
      timeUntilNextQuestion,
    });

    game.question = null;
    resolve(null);
  });
}

const clients: { [clientId: string]: any } = {};
const games: {
  [gameId: string]: {
    id: string;
    code: string;
    players: Player[];
    question: string | null;
    currentRound: {
      roundNumber: number;
      roundScores: {
        [playerId: string]: number;
      };
    };
    creator: {
      id: string;
      name: string;
    };
    started: boolean;
  };
} = {};
const gameCodes: { [code: string]: string } = {};
const guesses: { [gameId: string]: string[] } = {};

const app = express();
const server = app.listen(9090, () =>
  console.log("Server started at port 9090")
);

app.get("/", (req, res) => {
  res.send("websocket is running");
});

app.get("/code/:code", (req, res) => {
  const gameId = gameCodes[req.params.code];
  if (!gameId)
    return res.json({
      status: 404,
      message: "Game code not found",
    });

  res.json({
    status: 200,
    gameId,
  });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (socket) => {
    wss.emit("connection", socket, request);
  });
});

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(`https://web.socket/${req.url}`);
  const clientId = v4();
  const token = v4();
  let name;

  try {
    if (!url.searchParams.get("name") || url.searchParams.get("name") === "") {
      name = randomName();
    } else {
      name = decodeURIComponent(url.searchParams.get("name"));
    }
  } catch {
    name = randomName();
  }

  clients[token] = { connection: ws, clientId, name };

  ws.send(JSON.stringify({ method: "connect", token, clientId, name }));
  ws.on("open", () => {
    console.log("open");
  });

  ws.on("close", () => {
    if (!clients[token]?.currentGame) return delete clients[token];
    sendToGamePlayers(
      games[clients[token].currentGame],
      {
        method: "join",
      },
      (player) => player.clientId !== clients[token].clientId
    );

    delete clients[token];
  });

  ws.on("message", async (message) => {
    const data = JSON.parse(message.toString());

    if (data.method === "create") {
      const token = data.token;
      const client = clients[token];
      const clientId = client.clientId;
      const gameId = v4();
      const gameCode = generateGameCode();
      games[gameId] = {
        id: gameId,
        code: gameCode,
        players: [
          {
            clientId,
            name: client.name,
            score: 0,
          },
        ],
        question: null,
        currentRound: {
          roundNumber: 0,
          roundScores: {},
        },
        creator: {
          id: clientId,
          name: client.name,
        },
        started: false,
      };

      gameCodes[gameCode] = gameId;

      const connection = clients[token]?.connection;
      clients[token].currentGame = gameId;

      connection.send(
        JSON.stringify({
          method: "create",
          game: games[gameId],
        })
      );
    }

    if (data.method === "start") {
      const token = data.token;
      const client = clients[token];
      const clientId = client.clientId;
      const gameId = data.gameId;
      const game = games[gameId];
      const connection = clients[token]?.connection;
      if (!connection) return;
      if (!game || game?.creator.id !== clientId || game?.started)
        return connection.send(
          JSON.stringify({
            method: "start",
            errorCode: 404,
            error: "Game not found",
          })
        );

      game.started = true;

      sendToGamePlayers(game, {
        method: "start",
      });

      const randomizedQuestions = [...shuffle(questions)].splice(0, 10);

      for (
        let index = 0;
        index < Math.min(randomizedQuestions.length, 10);
        index++
      ) {
        const isLast = index === randomizedQuestions.length - 1;
        const question = randomizedQuestions[index];

        await sendQuestion(game, question, 30000, 10000);
        if (isLast) {
          sendToGamePlayers(game, {
            method: "end",
            game,
          });
          for (let index = 0; index < game.players.length; index++) {
            const player = game.players[index];
            if (!player) continue;
            const client = clients[player.clientId];
            if (!client) continue;
            client.currentGame = null;
          }
          delete games[gameId];
          delete gameCodes[game.code];

          break;
        }
        await sleep(10000);
      }
    }

    if (data.method === "join code") {
      const token = data.token;
      const gameId = gameCodes[data.code];

      ws.emit(
        "message",
        JSON.stringify({
          method: "join",
          token,
          gameId,
        })
      );
    }

    if (data.method === "join") {
      const token = data.token;
      const client = clients[token];
      if (!client) return;
      const clientId = client.clientId;
      const gameId = data.gameId;
      const game = games[gameId];
      const type = data?.type || "join"; /* join | leave */
      const connection = clients[token]?.connection;
      if (!game)
        return connection.send(
          JSON.stringify({
            method: "join",
            errorCode: 404,
            error: "Game not found",
          })
        );

      if (clients[token]?.currentGame)
        return connection.send(
          JSON.stringify({
            method: "join",
            errorCode: 409,
            error: "Already connected to a game",
          })
        );

      if (type === "join") {
        game.players.push({
          clientId,
          name: client.name,
          score: 0,
        });

        clients[token].currentGame = gameId;
      } else {
        game.players = game.players.filter(
          (player) => player.clientId !== clientId
        );
        clients[token].currentGame = null;
      }

      for (let index = 0; index < game.players.length; index++) {
        const player = game.players[index];

        Object.values(clients)
          .find((cl) => cl.clientId === player.clientId)
          .connection.send(
            JSON.stringify({
              method: "join",
              game: games[gameId],
            })
          );
      }
    }

    if (data.method === "message") {
      const token = data?.token;
      const client = clients[token];
      if (!client) return;
      const connection = client.connection;
      const gameId = data.gameId;
      const game = games[gameId];
      let similar;
      if (!game)
        return connection.send(
          JSON.stringify({
            method: "join",
            errorCode: 404,
            error: "Game not found",
          })
        );

      let correct = false;
      const content = data.content;

      if (game.question) {
        const question = questions.find(
          (question) => question.title === game.question
        );

        similar = findSimilar(content, question.answers, { criteria: 0.6 });

        if (
          (question.answers
            .map((answer) => answer.toLowerCase())
            .includes(content) ||
            similar.length > 0) &&
          !guesses[gameId].includes(similar[0])
        ) {
          correct = true;
        }
      }

      if (correct) {
        guesses[gameId] = [similar[0], ...(guesses?.[gameId] || [])];
        game.players.find(
          (player) => player.clientId === client.clientId
        ).score += 25;

        if (!game.currentRound.roundScores[client.clientId]) {
          game.currentRound.roundScores[client.clientId] = 1;
        } else {
          game.currentRound.roundScores[client.clientId]++;
        }
      }

      for (let index = 0; index < game.players.length; index++) {
        const player = Object.values(clients).find(
          (cl) => cl.clientId === game.players[index].clientId
        );

        player?.connection?.send?.(
          JSON.stringify({
            method: "message",
            author: {
              id: client.clientId,
              name: client.name,
            },
            game,
            content: correct ? similar[0] : content,
            correct,
          })
        );
      }
    }
  });
});
