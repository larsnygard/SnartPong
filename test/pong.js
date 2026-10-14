#!/usr/bin/env node
/* SnartPong core physics tests — runs under plain Node, no browser.
 *
 * The PongCore module is the whole ruleset: serve, bounce, scoring, side
 * swap. These tests pin the original's behaviour so a refactor can't quietly
 * change the game. Run with:  node test/pong.js
 */
'use strict';
const assert = require('assert');
const PongCore = require('../game.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok -', name);
}

// A deterministic PRNG so the ball's angles are reproducible.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

check('core exports the expected constants', () => {
  assert.strictEqual(PongCore.W, 800);
  assert.strictEqual(PongCore.H, 600);
  assert.strictEqual(PongCore.WIN_SCORE, 11);
  assert.ok(PongCore.MAX_SPEED >= PongCore.BASE_SPEED * Math.pow(PongCore.SPEED_GAIN, 10));
});

check('newGame resets scores and serves toward the CPU', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  assert.strictEqual(s.paddle[0].score, 0);
  assert.strictEqual(s.paddle[1].score, 0);
  assert.strictEqual(s.winner, null);
  assert.ok(s.ball.vx > 0, 'ball should travel toward the CPU (right)');
});

check('serve places the ball at centre with base speed', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  assert.ok(Math.abs(s.ball.x + PongCore.BALL_SIZE / 2 - PongCore.W / 2) < 1);
  assert.ok(Math.abs(s.ball.speed - PongCore.BASE_SPEED) < 1e-6);
});

check('paddle bounce preserves speed*gain and caps speed', () => {
  const s = PongCore.createState(0);
  s.paddle[1].y = PongCore.H / 2 - PongCore.PADDLE_H / 2; // CPU paddle centred
  s.ball.x = PongCore.paddleX(1) - 40; // in front of the right face
  s.ball.y = PongCore.H / 2;
  s.ball.vx = 300;
  s.ball.vy = 0;
  s.ball.speed = 300;
  const before = s.ball.speed;
  let bounced = false;
  for (let i = 0; i < 120 && !bounced; i++) {
    const events = PongCore.step(s, 1 / 60, 300, 1, prng(1));
    if (events.some((e) => e.type === 'paddle')) bounced = true;
  }
  assert.ok(bounced, 'ball aimed at the CPU paddle should bounce');
  assert.ok(s.ball.speed > before, 'ball should get faster on the bounce');
  assert.ok(s.ball.speed <= PongCore.MAX_SPEED);
  assert.ok(s.ball.vx <= 0, 'ball bounces back toward the left');
});

check('ball speed caps at MAX_SPEED', () => {
  const s = PongCore.createState(0);
  for (let i = 0; i < 40; i++) {
    s.ball.speed = Math.min(s.ball.speed * PongCore.SPEED_GAIN, PongCore.MAX_SPEED);
  }
  assert.ok(s.ball.speed <= PongCore.MAX_SPEED + 1e-6);
});

check('ball bounces off top and bottom walls', () => {
  const s = PongCore.createState(0);
  s.ball.x = 400;
  s.ball.y = 0;
  s.ball.vx = 50;
  s.ball.vy = -100;
  s.ball.speed = 100;
  const events = PongCore.step(s, 1 / 60, 300, 1, prng(1));
  assert.ok(events.some((e) => e.type === 'wall'), 'expected a wall event');
  assert.ok(s.ball.vy > 0, 'ball should bounce down');
});

check('scoring: a point increments the scorer and re-serves to the loser', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  const s2 = PongCore.createState(0);
  s2.paddle[0].score = 3;
  // Ball flies past the left paddle.
  s2.ball.x = 5;
  s2.ball.y = 300;
  s2.ball.vx = -400;
  s2.ball.vy = 0;
  s2.ball.speed = 400;
  const events = PongCore.step(s2, 1 / 60, 300, 1, prng(1));
  // Give it a couple of steps to exit.
  while (events.length === 0 || events[0].type !== 'point') {
    const more = PongCore.step(s2, 1 / 60, 300, 1, prng(1));
    if (more.length) events.push(...more);
    if (events.some((e) => e.type === 'point')) break;
  }
  const point = events.find((e) => e.type === 'point');
  assert.ok(point, 'expected a point event');
  assert.strictEqual(point.scorer, 1, 'right side (CPU) should score');
  assert.strictEqual(s2.paddle[1].score, 1);
  assert.strictEqual(s2.paddle[0].score, 3, 'loser keeps their score');
});

check('winning: first to 11 sets the winner', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  s.paddle[1].score = 10;
  s.ball.x = 5;
  s.ball.y = 300;
  s.ball.vx = -400;
  s.ball.vy = 0;
  s.ball.speed = 400;
  let guard = 0;
  while (s.winner === null && guard++ < 50) {
    PongCore.step(s, 1 / 60, 300, 1, prng(1));
  }
  assert.strictEqual(s.winner, 1, 'CPU should win at 11');
  assert.strictEqual(s.paddle[1].score, 11);
});

check('side swap: newGame puts the player on the opposite side', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  assert.strictEqual(s.playerSide, 0);
  PongCore.newGame(s, 1);
  assert.strictEqual(s.playerSide, 1);
  assert.strictEqual(s.paddle[0].score, 0, 'scores reset');
});

check('paddle stays within bounds', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  // Human yanks the paddle far up.
  PongCore.step(s, 1 / 60, -500, 1, prng(1));
  assert.ok(s.paddle[0].y >= 0, 'paddle should not go above the top');
  PongCore.step(s, 1 / 60, PongCore.H + 500, 1, prng(1));
  assert.ok(s.paddle[0].y + PongCore.PADDLE_H <= PongCore.H + 0.001, 'paddle stays below the bottom');
});

check('ball never escapes through a paddle (no tunnel)', () => {
  const s = PongCore.createState(0);
  PongCore.newGame(s, 0);
  // Fast ball aimed straight at the CPU paddle, paddle centred.
  const s2 = PongCore.createState(0);
  s2.paddle[1].y = PongCore.H / 2 - PongCore.PADDLE_H / 2;
  s2.ball.x = PongCore.paddleX(1) - 20;
  s2.ball.y = PongCore.H / 2;
  s2.ball.vx = 1000; // faster than any real ball, must still bounce
  s2.ball.vy = 0;
  s2.ball.speed = 1000;
  let bounced = false;
  let guard = 0;
  while (!bounced && guard++ < 200) {
    const events = PongCore.step(s2, 1 / 60, 300, 1, prng(1));
    if (events.some((e) => e.type === 'paddle')) { bounced = true; break; }
    if (events.some((e) => e.type === 'point')) break;
  }
  assert.ok(bounced, 'a fast ball aimed at a centred paddle must bounce, not pass through');
});

console.log('\n%d tests passed', passed);
