import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getClosedPreviousMonth, nowIso, shiftCompetencia } from './periodo.ts';

export type DBInstance = Database.Database;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, originalHex] = storedHash.split(':');
  if (!salt || !originalHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

export function createDatabase(dbPath?: string): DBInstance {
  const resolvedPath =
    dbPath ?? process.env.SQLITE_PATH ?? path.resolve(process.cwd(), 'data', 'brasilink_separacao.sqlite');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  initSchema(db);
  return db;
}

function initSchema(db: DBInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      perfil TEXT NOT NULL CHECK (perfil IN ('COORDENADOR', 'ESTOQUE')),
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      criado_em TEXT NOT NULL,
      expira_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      criado_em TEXT NOT NULL,
      actor_id INTEGER,
      evento TEXT NOT NULL,
      metodo TEXT NOT NULL,
      rota TEXT NOT NULL,
      status INTEGER NOT NULL,
      ip_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_criado ON audit_logs(criado_em);

    CREATE TABLE IF NOT EXISTS tecnicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matricula TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      filial TEXT NOT NULL DEFAULT '',
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      unidade TEXT NOT NULL DEFAULT 'un',
      estoque_atual INTEGER NOT NULL DEFAULT 0 CHECK (estoque_atual >= 0),
      limite_maximo INTEGER NOT NULL CHECK (limite_maximo >= 0),
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS minimos_tecnicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
      minimo_manual INTEGER NOT NULL CHECK (minimo_manual >= 0),
      atualizado_em TEXT NOT NULL,
      UNIQUE (tecnico_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS consumos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
      competencia TEXT NOT NULL,
      quantidade_usada INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_usada >= 0),
      UNIQUE (tecnico_id, item_id, competencia)
    );

    CREATE TABLE IF NOT EXISTS saldos_tecnicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES itens(id) ON DELETE CASCADE,
      quantidade INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
      atualizado_em TEXT NOT NULL,
      UNIQUE (tecnico_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS separacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id),
      tecnico_nome_snapshot TEXT NOT NULL,
      competencia TEXT NOT NULL,
      competencia_label TEXT NOT NULL,
      regra_versao TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('RASCUNHO', 'CALCULADA', 'SEPARADA')),
      calculado_por_id INTEGER NOT NULL REFERENCES usuarios(id),
      calculado_por_nome TEXT NOT NULL,
      calculado_em TEXT NOT NULL,
      enviado_por_id INTEGER REFERENCES usuarios(id),
      enviado_por_nome TEXT,
      enviado_em TEXT,
      confirmado_por_id INTEGER REFERENCES usuarios(id),
      confirmado_por_nome TEXT,
      confirmado_em TEXT,
      observacoes TEXT
    );

    CREATE TABLE IF NOT EXISTS separacao_itens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      separacao_id INTEGER NOT NULL REFERENCES separacoes(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES itens(id),
      item_codigo_snapshot TEXT NOT NULL,
      item_nome_snapshot TEXT NOT NULL,
      unidade_snapshot TEXT NOT NULL,
      uso_mes_anterior INTEGER NOT NULL,
      demanda_semanal_exata REAL NOT NULL,
      demanda_diaria_informativa REAL NOT NULL,
      alvo_base INTEGER NOT NULL,
      minimo_manual_snapshot INTEGER,
      minimo_efetivo INTEGER NOT NULL,
      minimo_origem TEXT NOT NULL CHECK (minimo_origem IN ('MANUAL', 'DERIVADO')),
      limite_maximo_snapshot INTEGER NOT NULL,
      alvo_kit INTEGER NOT NULL,
      saldo_tecnico_snapshot INTEGER NOT NULL,
      estoque_almoxarifado_snapshot INTEGER NOT NULL,
      quantidade_calculada_original INTEGER NOT NULL,
      quantidade_solicitada INTEGER NOT NULL,
      quantidade_disponivel INTEGER NOT NULL,
      faltante INTEGER NOT NULL,
      ajuste_justificativa TEXT,
      ajustado_por_nome TEXT,
      ajustado_em TEXT,
      comparacao_limites TEXT NOT NULL CHECK (comparacao_limites IN ('ABAIXO_MINIMO', 'DENTRO_LIMITES', 'ACIMA_MAXIMO')),
      consumo_atipico INTEGER NOT NULL DEFAULT 0,
      sem_consumo INTEGER NOT NULL DEFAULT 0,
      sem_saldo_almoxarifado INTEGER NOT NULL DEFAULT 0,
      alerta_minimo_maior_maximo INTEGER NOT NULL DEFAULT 0,
      quantidade_entregue INTEGER
    );

    CREATE TABLE IF NOT EXISTS pendencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      separacao_id INTEGER NOT NULL REFERENCES separacoes(id) ON DELETE CASCADE,
      separacao_item_id INTEGER NOT NULL REFERENCES separacao_itens(id) ON DELETE CASCADE,
      tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id),
      tecnico_nome_snapshot TEXT NOT NULL,
      item_id INTEGER NOT NULL REFERENCES itens(id),
      item_nome_snapshot TEXT NOT NULL,
      unidade_snapshot TEXT NOT NULL,
      quantidade_solicitada INTEGER NOT NULL,
      quantidade_referencia INTEGER NOT NULL,
      diferenca INTEGER NOT NULL CHECK (diferenca > 0),
      tipo TEXT NOT NULL CHECK (tipo IN ('FALTA_ESTOQUE', 'ENTREGA_PARCIAL')),
      status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA')),
      criado_em TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_separacoes_status ON separacoes(status);
    CREATE INDEX IF NOT EXISTS idx_separacoes_tecnico ON separacoes(tecnico_id);
    CREATE INDEX IF NOT EXISTS idx_pendencias_status ON pendencias(status);
  `);
}

export function seedDatabaseIfEmpty(db: DBInstance, now: Date = new Date()): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM usuarios').get() as { c: number }).c;
  if (userCount > 0) return;

  const ts = nowIso();
  const fechada = getClosedPreviousMonth(now);
  const anterior = shiftCompetencia(fechada.competencia, -1);

  const tx = db.transaction(() => {
    // 1. Usuários iniciais (sem cadastro público)
    const insertUser = db.prepare(`
      INSERT INTO usuarios (nome, username, senha_hash, perfil, ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);
    insertUser.run('Carlos Eduardo (Coordenação)', 'coordenador', hashPassword('Coord@2026'), 'COORDENADOR', ts, ts);
    insertUser.run('Mariana Silva (Almoxarifado)', 'estoque', hashPassword('Estoque@2026'), 'ESTOQUE', ts, ts);

    // 2. Técnicos simulados (3 iniciais, escalável para 11+ sem alterações)
    const insertTec = db.prepare(`
      INSERT INTO tecnicos (matricula, nome, filial, ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const tec1 = Number(insertTec.run('TEC-01', 'Lucas Ferreira', 'Zona Norte', ts, ts).lastInsertRowid);
    const tec2 = Number(insertTec.run('TEC-02', 'Rafael Oliveira', 'Zona Sul', ts, ts).lastInsertRowid);
    const tec3 = Number(insertTec.run('TEC-03', 'Bruno Mendes', 'Zona Central', ts, ts).lastInsertRowid);

    // 3. Produtos simulados (6 materiais típicos FTTH)
    const insertItem = db.prepare(`
      INSERT INTO itens (codigo, nome, unidade, estoque_atual, limite_maximo, ativo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const item1 = Number(insertItem.run('MAT-001', 'Conector APC/SC Verde', 'un', 180, 60, ts, ts).lastInsertRowid);
    const item2 = Number(insertItem.run('MAT-002', 'ONU Wi-Fi Dual Band AC1200', 'un', 14, 10, ts, ts).lastInsertRowid);
    const item3 = Number(insertItem.run('MAT-003', 'Cabo Drop Flat 1FO (metros)', 'm', 900, 500, ts, ts).lastInsertRowid);
    const item4 = Number(insertItem.run('MAT-004', 'Alça Pré-Formada Drop', 'un', 6, 40, ts, ts).lastInsertRowid);
    const item5 = Number(insertItem.run('MAT-005', 'Esticador Cunha Plástico', 'un', 0, 50, ts, ts).lastInsertRowid);
    const item6 = Number(insertItem.run('MAT-006', 'Pigtail SC/APC Monomodo', 'un', 65, 25, ts, ts).lastInsertRowid);

    // 4. Mínimos manuais por técnico x produto (exemplos variados)
    const insertMin = db.prepare(`
      INSERT INTO minimos_tecnicos (tecnico_id, item_id, minimo_manual, atualizado_em)
      VALUES (?, ?, ?, ?)
    `);
    insertMin.run(tec1, item1, 30, ts); // Lucas: mínimo manual 30 para Conector
    insertMin.run(tec2, item2, 6, ts);  // Rafael: mínimo manual 6 para ONU
    insertMin.run(tec3, item4, 15, ts); // Bruno: mínimo manual 15 para Alça

    // 5. Consumos simulados (competência fechada atual e anterior)
    const insertConsumo = db.prepare(`
      INSERT INTO consumos (tecnico_id, item_id, competencia, quantidade_usada)
      VALUES (?, ?, ?, ?)
    `);

    const consumosFechada: Array<[number, number, number]> = [
      // Lucas (TEC-01): consumo atípico (> max), normal, falta parcial, sem estoque, sem consumo
      [tec1, item1, 95],  // > max 60 -> ACIMA_MAXIMO + Consumo atípico
      [tec1, item2, 18],  // > max 10 -> ACIMA_MAXIMO + Consumo atípico
      [tec1, item3, 420], // dentro dos limites (max 500)
      [tec1, item4, 38],  // alvoBase=13, solicita 10, estoque=6 -> falta parcial!
      [tec1, item5, 28],  // estoque=0 -> Sem saldo no almoxarifado!
      [tec1, item6, 0],   // 0 -> Sem consumo no período

      // Rafael (TEC-02)
      [tec2, item1, 24],  // dentro dos limites (alvoBase=8)
      [tec2, item2, 4],   // < min manual 6 -> ABAIXO_MINIMO
      [tec2, item3, 620], // > max 500 -> ACIMA_MAXIMO + Consumo atípico
      [tec2, item4, 22],
      [tec2, item5, 16],
      [tec2, item6, 15],

      // Bruno (TEC-03)
      [tec3, item1, 45],
      [tec3, item2, 9],
      [tec3, item3, 310],
      [tec3, item4, 10],  // < min manual 15 -> ABAIXO_MINIMO
      [tec3, item5, 0],   // sem consumo
      [tec3, item6, 20],
    ];

    for (const [tId, iId, qtd] of consumosFechada) {
      insertConsumo.run(tId, iId, fechada.competencia, qtd);
      // Também semeia competência anterior com variação leve para histórico simulado
      insertConsumo.run(tId, iId, anterior.competencia, Math.max(0, Math.round(qtd * 0.85)));
    }

    // 6. Saldos iniciais dos técnicos (simulados)
    const insertSaldo = db.prepare(`
      INSERT INTO saldos_tecnicos (tecnico_id, item_id, quantidade, atualizado_em)
      VALUES (?, ?, ?, ?)
    `);
    const saldos: Array<[number, number, number]> = [
      [tec1, item1, 12],
      [tec1, item2, 2],
      [tec1, item3, 40],
      [tec1, item4, 3],
      [tec1, item5, 2],
      [tec1, item6, 4],

      [tec2, item1, 5],
      [tec2, item2, 1],
      [tec2, item3, 120],
      [tec2, item4, 2],
      [tec2, item5, 0],
      [tec2, item6, 2],

      [tec3, item1, 8],
      [tec3, item2, 3],
      [tec3, item3, 80],
      [tec3, item4, 5],
      [tec3, item5, 4],
      [tec3, item6, 1],
    ];
    for (const [tId, iId, qtd] of saldos) {
      insertSaldo.run(tId, iId, qtd, ts);
    }
  });

  tx();
}
