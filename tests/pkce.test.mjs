import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64UrlFromBytes, pkceChallenge, buildAuthUrl,
  tokenExchangeBody, tokenRefreshBody
} from '../frost-store.js';

test('base64UrlFromBytes is URL-safe and unpadded', () => {
  // 0xFB 0xFF -> base64 "+/8=" -> base64url "-_8"
  assert.equal(base64UrlFromBytes(new Uint8Array([0xFB, 0xFF])), '-_8');
});

test('pkceChallenge matches the RFC 7636 Appendix B test vector', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = await pkceChallenge(verifier);
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('buildAuthUrl includes the required PKCE + offline params', () => {
  const url = buildAuthUrl({
    appKey: 'KEY', redirectUri: 'https://ried.cl/iskrem/',
    challenge: 'CHAL', scope: 'files.content.read files.content.write'
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://www.dropbox.com/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'KEY');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('code_challenge'), 'CHAL');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://ried.cl/iskrem/');
  assert.equal(u.searchParams.get('token_access_type'), 'offline');
});

test('token bodies carry the right grant + fields', () => {
  const ex = tokenExchangeBody({ code:'C', verifier:'V', appKey:'K', redirectUri:'R' });
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('code'), 'C');
  assert.equal(ex.get('code_verifier'), 'V');
  assert.equal(ex.get('client_id'), 'K');
  assert.equal(ex.get('redirect_uri'), 'R');

  const rf = tokenRefreshBody({ refreshToken:'RT', appKey:'K' });
  assert.equal(rf.get('grant_type'), 'refresh_token');
  assert.equal(rf.get('refresh_token'), 'RT');
  assert.equal(rf.get('client_id'), 'K');
});
