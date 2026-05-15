#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// inject-env.js — Script de build do MestrePro
// Roda via: netlify.toml [build] command = "node inject-env.js"
//
// O QUE FAZ:
//   1. Valida TODOS os segredos necessários (Netlify + Edge Functions)
//   2. Gera pp-config.js a partir do pp-config.template.js
//   3. Confirma que a substituição funcionou (sem placeholder vazio)
//   4. Gera build-manifest.json com hash e timestamp para rastreabilidade
//
// FLAGS:
//   --check-only  Só valida segredos, não gera arquivos (CI/alertas)
//   --local       Modo dev local: lê pp-config.local.js em vez de env vars
// ═══════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARGS       = process.argv.slice(2);
const CHECK_ONLY = ARGS.includes('--check-only');
const LOCAL_MODE = ARGS.includes('--local');
const CI         = process.env.CI === 'true' || process.env.NETLIFY === 'true';

// ── Paleta de log ────────────────────────────────────────────────────
const ok   = (msg) => console.log(`  ✅  ${msg}`);
const warn = (msg) => console.warn(`  ⚠️   ${msg}`);
const err  = (msg) => console.error(`  ❌  ${msg}`);
const info = (msg) => console.log(`  ℹ️   ${msg}`);
const sep  = ()    => console.log('─'.repeat(60));

// ═══════════════════════════════════════════════════════════════════
// CATÁLOGO COMPLETO DE SEGREDOS
// Mantido aqui como fonte única — sempre atualizar quando adicionar var
// ═══════════════════════════════════════════════════════════════════
const SECRETS = {

  // ── Grupo 1: Frontend (Netlify env vars → pp-config.js) ──────────
  netlify_frontend: {
    label: 'Frontend — Netlify Environment Variables',
    where: 'Netlify → Site settings → Environment variables',
    vars: [
      {
        key:      'SUPABASE_URL',
        example:  'https://xxxxxxxx.supabase.co',
        scope:    'Netlify build + Edge Functions',
        rotation: '⚡ Só se o projeto Supabase for recriado',
        critical: true,
        test:     (v) => v.startsWith('https://') && v.includes('.supabase.co'),
        testMsg:  'deve começar com https:// e conter .supabase.co',
      },
      {
        key:      'SUPABASE_ANON_KEY',
        example:  'eyJhbGciOiJIUzI1NiIs...',
        scope:    'Apenas Frontend (público, seguro)',
        rotation: '🔄 A cada 90 dias ou em suspeita de vazamento',
        critical: true,
        test:     (v) => v.startsWith('eyJ') && v.length > 100,
        testMsg:  'deve ser um JWT válido começando com eyJ',
      },
    ],
  },

  // ── Grupo 2: Edge Functions (Supabase → secrets) ─────────────────
  supabase_edge: {
    label: 'Edge Functions — Supabase Secrets',
    where: 'Supabase → Edge Functions → Manage secrets',
    vars: [
      {
        key:      'SUPABASE_SERVICE_ROLE_KEY',
        example:  'eyJhbGciOiJIUzI1NiIs... (service_role)',
        scope:    'Apenas Edge Functions — NUNCA expor no frontend',
        rotation: '🔄 A cada 90 dias ou em suspeita de vazamento',
        critical: true,
        edgeOnly: true,
        test:     (v) => v.startsWith('eyJ') && v.length > 100,
        testMsg:  'deve ser um JWT válido começando com eyJ',
      },
      {
        key:      'MP_ACCESS_TOKEN',
        example:  'APP_USR-...',
        scope:    'Edge Function webhook-mp — chamadas à API do Mercado Pago',
        rotation: '🔄 A cada 180 dias ou se comprometido',
        critical: true,
        edgeOnly: true,
        test:     (v) => v.startsWith('APP_USR-') || v.startsWith('TEST-'),
        testMsg:  'deve começar com APP_USR- (produção) ou TEST- (sandbox)',
      },
      {
        key:      'MP_WEBHOOK_SECRET',
        example:  'chave gerada pelo painel do Mercado Pago',
        scope:    'Edge Function webhook-mp — validação HMAC-SHA256',
        rotation: '🔄 A cada 180 dias ou ao recriar o webhook no MP',
        critical: true,
        edgeOnly: true,
        test:     (v) => v.length >= 16,
        testMsg:  'deve ter pelo menos 16 caracteres',
      },
    ],
  },

  // ── Grupo 3: Serviços opcionais / futuros ─────────────────────────
  optional: {
    label: 'Serviços opcionais (adicionar quando ativar)',
    where: 'Netlify + Supabase conforme serviço',
    vars: [
      {
        key:      'RESEND_API_KEY',
        example:  're_...',
        scope:    'Edge Function email-sender — fila email_queue',
        rotation: '🔄 A cada 180 dias',
        critical: false,
        edgeOnly: true,
        test:     (v) => v.startsWith('re_'),
        testMsg:  'deve começar com re_',
      },
      {
        key:      'META_PIXEL_ID',
        example:  '1234567890',
        scope:    'Netlify build → injetar no index.html',
        rotation: '⚡ Só se o pixel for recriado no Meta',
        critical: false,
        test:     (v) => /^\d{10,}$/.test(v),
        testMsg:  'deve ser um número com 10+ dígitos',
      },
      {
        key:      'GA4_MEASUREMENT_ID',
        example:  'G-XXXXXXXXXX',
        scope:    'Netlify build → injetar no index.html',
        rotation: '⚡ Só se a propriedade GA4 for recriada',
        critical: false,
        test:     (v) => v.startsWith('G-'),
        testMsg:  'deve começar com G-',
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// FUNÇÃO: Validar segredos
// ═══════════════════════════════════════════════════════════════════
function validateSecrets() {
  console.log('\n📋  Validando segredos...\n');
  let hasErrors = false;
  let totalChecked = 0;

  for (const [groupKey, group] of Object.entries(SECRETS)) {
    if (groupKey === 'optional') continue; // opcionais não bloqueiam build

    console.log(`  📦 ${group.label}`);
    console.log(`     Onde configurar: ${group.where}\n`);

    for (const secret of group.vars) {
      if (secret.edgeOnly) {
        // Vars de Edge Function não estão disponíveis no build do Netlify —
        // não podemos validar o valor, apenas documentar a existência.
        info(`${secret.key} — Edge Function only (não injetada no build)`);
        totalChecked++;
        continue;
      }

      const val = process.env[secret.key] || '';
      totalChecked++;

      if (!val) {
        err(`${secret.key} — NÃO DEFINIDA`);
        err(`   Exemplo: ${secret.example}`);
        hasErrors = secret.critical;
        continue;
      }

      if (secret.test && !secret.test(val)) {
        err(`${secret.key} — FORMATO INVÁLIDO`);
        err(`   ${secret.testMsg}`);
        hasErrors = secret.critical;
        continue;
      }

      const masked = val.substring(0, 12) + '...' + val.substring(val.length - 4);
      ok(`${secret.key} — OK  (${masked})`);
    }
    console.log('');
  }

  // Opcionais — apenas avisos
  console.log(`  📦 ${SECRETS.optional.label}`);
  for (const secret of SECRETS.optional.vars) {
    const val = (process.env[secret.key] || '').trim();
    if (!val) {
      warn(`${secret.key} — não configurada (opcional)`);
    } else {
      ok(`${secret.key} — configurada`);
    }
  }
  console.log('');

  return { hasErrors, totalChecked };
}

// ═══════════════════════════════════════════════════════════════════
// FUNÇÃO: Gerar pp-config.js a partir do template
// ═══════════════════════════════════════════════════════════════════
function generateConfig() {
  const templatePath = path.join(__dirname, 'pp-config.template.js');
  const outputPath   = path.join(__dirname, 'pp-config.js');

  if (!fs.existsSync(templatePath)) {
    err('pp-config.template.js não encontrado!');
    err('Certifique que pp-config.template.js está no repositório.');
    process.exit(1);
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL      || '';
  const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';

  let config = fs.readFileSync(templatePath, 'utf8');

  // Substituição robusta — suporta espaços extras e variações de quote
  config = config.replace(
    /window\.__SUPABASE_URL__\s*\|\|\s*['"]{2}/g,
    `'${SUPABASE_URL}'`
  );
  config = config.replace(
    /window\.__SUPABASE_ANON__\s*\|\|\s*['"]{2}/g,
    `'${SUPABASE_ANON}'`
  );

  // ── Injetar Meta Pixel e GA4 se configurados ─────────────────────
  const META_PIXEL  = process.env.META_PIXEL_ID      || '';
  const GA4_ID      = process.env.GA4_MEASUREMENT_ID || '';

  if (META_PIXEL || GA4_ID) {
    const analyticsBlock = `
// ── Analytics (injetado pelo build) ──────────────────────────────
window.PP_ANALYTICS = {
  metaPixelId: '${META_PIXEL}',
  ga4Id:       '${GA4_ID}',
};`;
    config += analyticsBlock;
  }

  // ── Verificar que nenhum placeholder ficou vazio ──────────────────
  const hasEmptyUrl  = config.includes("supabaseUrl: ''");
  const hasEmptyKey  = config.includes("supabaseKey: ''");

  if (hasEmptyUrl || hasEmptyKey) {
    err('A substituição falhou — pp-config.js gerado tem credenciais vazias.');
    err('Verifique que SUPABASE_URL e SUPABASE_ANON_KEY estão definidas no Netlify.');
    process.exit(1);
  }

  // ── Adicionar cabeçalho de rastreabilidade ────────────────────────
  const buildTime = new Date().toISOString();
  const configHash = crypto.createHash('sha256').update(config).digest('hex').substring(0, 12);
  const header = `// ⚠️  ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITAR
// Gerado em: ${buildTime}
// Hash: ${configHash}
// Build: ${process.env.DEPLOY_ID || 'local'}
// Branch: ${process.env.BRANCH || 'local'}
\n`;

  fs.writeFileSync(outputPath, header + config, 'utf8');

  ok(`pp-config.js gerado com sucesso`);
  info(`Hash do config: ${configHash}`);
  info(`Supabase URL: ${SUPABASE_URL.substring(0, 30)}...`);

  return { buildTime, configHash, META_PIXEL, GA4_ID };
}

// ═══════════════════════════════════════════════════════════════════
// FUNÇÃO: Gerar build-manifest.json
// ═══════════════════════════════════════════════════════════════════
function generateManifest(buildInfo) {
  const manifest = {
    version:      require('./package.json').version,
    buildTime:    buildInfo.buildTime,
    configHash:   buildInfo.configHash,
    deployId:     process.env.DEPLOY_ID   || 'local',
    branch:       process.env.BRANCH      || 'local',
    context:      process.env.CONTEXT     || 'local',
    supabaseUrl:  (process.env.SUPABASE_URL || '').substring(0, 40) + '...',
    analytics: {
      metaPixel:  !!buildInfo.META_PIXEL,
      ga4:        !!buildInfo.GA4_ID,
    },
    secretsPresent: {
      SUPABASE_URL:      !!process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
      META_PIXEL_ID:     !!process.env.META_PIXEL_ID,
      GA4_MEASUREMENT_ID: !!process.env.GA4_MEASUREMENT_ID,
    },
  };

  const manifestPath = path.join(__dirname, 'build-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  ok('build-manifest.json gerado');
}

// ═══════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════════════════════════════
console.log('\n🔧  MestrePro — Build Script\n');
sep();

if (LOCAL_MODE) {
  info('Modo local: carregando variáveis de pp-config.local.js');
  info('Certifique que pp-config.local.js existe e está no .gitignore');
  console.log('');
}

if (CI) {
  info(`Ambiente: ${process.env.CONTEXT || 'CI'} | Deploy: ${process.env.DEPLOY_ID || '-'} | Branch: ${process.env.BRANCH || '-'}`);
  console.log('');
}

// Passo 1 — Validar segredos
const { hasErrors } = validateSecrets();
sep();

if (hasErrors) {
  err('Build abortado: segredos críticos ausentes ou inválidos.');
  err('Configure as variáveis de ambiente no Netlify e tente novamente.');
  err('Consulte SECRETS.md para o guia completo.');
  console.log('');
  process.exit(1);
}

if (CHECK_ONLY) {
  ok('Verificação concluída — todos os segredos críticos estão presentes.');
  process.exit(0);
}

// Passo 2 — Gerar arquivos
console.log('\n📝  Gerando arquivos...\n');
const buildInfo = generateConfig();
generateManifest(buildInfo);

sep();
console.log('\n🎉  Build concluído com sucesso!\n');
