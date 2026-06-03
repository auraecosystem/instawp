import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { escapeMysqlString, formatMysqlValue, quoteIdent, generateMysqlDump } from '../lib/sqlite-to-mysql.js';

describe('escapeMysqlString', () => {
  it('escapes quotes, backslashes, and control chars', () => {
    expect(escapeMysqlString("it's")).toBe("it\\'s");
    expect(escapeMysqlString('a\\b')).toBe('a\\\\b');
    expect(escapeMysqlString('line1\nline2')).toBe('line1\\nline2');
    expect(escapeMysqlString('tab\there')).toBe('tab\\there');
    expect(escapeMysqlString('nul\0byte')).toBe('nul\\0byte');
    expect(escapeMysqlString('say "hi"')).toBe('say \\"hi\\"');
  });
  it('leaves unicode/emoji untouched', () => {
    expect(escapeMysqlString('café 🎉')).toBe('café 🎉');
  });
});

describe('formatMysqlValue', () => {
  it('formats each SQLite value type', () => {
    expect(formatMysqlValue(null)).toBe('NULL');
    expect(formatMysqlValue(undefined)).toBe('NULL');
    expect(formatMysqlValue(42)).toBe('42');
    expect(formatMysqlValue(3.14)).toBe('3.14');
    expect(formatMysqlValue(10n)).toBe('10');
    expect(formatMysqlValue("o'brien")).toBe("'o\\'brien'");
    expect(formatMysqlValue(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe('0xdeadbeef');
    expect(formatMysqlValue(Buffer.alloc(0))).toBe("''");
    expect(formatMysqlValue(NaN)).toBe('NULL');
  });
});

describe('quoteIdent', () => {
  it('backtick-quotes and escapes embedded backticks', () => {
    expect(quoteIdent('wp_posts')).toBe('`wp_posts`');
    expect(quoteIdent('we`ird')).toBe('`we``ird`');
  });
});

describe('generateMysqlDump', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('dumps intersecting tables (cloud prefix remap), skips local-only + non-wp tables, escapes values', () => {
    dir = mkdtempSync(join(tmpdir(), 'iwp-s2m-'));
    const dbPath = join(dir, '.ht.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE wp_options (option_id INTEGER, option_name TEXT, option_value TEXT)');
    db.prepare('INSERT INTO wp_options VALUES (1,?,?)').run('siteurl', 'http://127.0.0.1:9400');
    db.prepare('INSERT INTO wp_options VALUES (2,?,?)').run("quote'd", 'a\\b\nc');
    db.exec('CREATE TABLE wp_posts (ID INTEGER, post_title TEXT, blob_col BLOB)');
    db.prepare('INSERT INTO wp_posts VALUES (1,?,?)').run('Hello', Buffer.from([0xde, 0xad]));
    db.exec('CREATE TABLE wp_plugin_only (id INTEGER)');   // local-only → skipped
    db.exec('CREATE TABLE other_table (id INTEGER)');       // not wp_ → ignored
    db.close();

    const out = join(dir, 'dump.sql');
    // Cloud uses a different prefix ("site_") and lacks wp_plugin_only.
    const res = generateMysqlDump({
      sqlitePath: dbPath,
      cloudPrefix: 'site_',
      cloudTables: new Set(['site_options', 'site_posts']),
      outPath: out,
    });
    const sql = readFileSync(out, 'utf-8');

    expect(res.tables.map((t) => t.cloud).sort()).toEqual(['site_options', 'site_posts']);
    expect(res.totalRows).toBe(3);
    expect(res.skipped).toContain('wp_plugin_only');

    expect(sql).toContain('SET FOREIGN_KEY_CHECKS=0;');
    expect(sql).toContain('SET NAMES utf8mb4;');
    expect(sql).toContain('TRUNCATE TABLE `site_options`;');
    expect(sql).toContain('INSERT INTO `site_options` (`option_id`,`option_name`,`option_value`) VALUES ');
    expect(sql).toContain('TRUNCATE TABLE `site_posts`;');
    expect(sql).toContain("'quote\\'d'");       // escaped single quote
    expect(sql).toContain("'a\\\\b\\nc'");        // escaped backslash + newline
    expect(sql).toContain('0xdead');             // BLOB → hex literal
    expect(sql).not.toContain('other_table');    // non-wp table ignored
    expect(sql).not.toContain('plugin_only');    // skipped table never written
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS=1;');
    expect(sql.trim().endsWith('SET SQL_MODE=@OLD_SQL_MODE;')).toBe(true);
  });

  it('preserves big integers > 2^53 losslessly (safeIntegers)', () => {
    dir = mkdtempSync(join(tmpdir(), 'iwp-s2m-'));
    const dbPath = join(dir, '.ht.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE wp_big (id INTEGER, n INTEGER)');
    db.prepare('INSERT INTO wp_big VALUES (?,?)').run(1n, 9223372036854775807n);
    db.close();
    const out = join(dir, 'd.sql');
    generateMysqlDump({ sqlitePath: dbPath, cloudPrefix: 'wp_', cloudTables: new Set(['wp_big']), outPath: out });
    const sql = readFileSync(out, 'utf-8');
    expect(sql).toContain('9223372036854775807');       // exact
    expect(sql).not.toContain('9223372036854776000');    // the lossy JS-number value
  });

  it('produces an empty-but-valid dump when no tables intersect', () => {
    dir = mkdtempSync(join(tmpdir(), 'iwp-s2m-'));
    const dbPath = join(dir, '.ht.sqlite');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE wp_options (a INTEGER)');
    db.close();
    const out = join(dir, 'dump.sql');
    const res = generateMysqlDump({ sqlitePath: dbPath, cloudPrefix: 'wp_', cloudTables: new Set(), outPath: out });
    expect(res.tables).toEqual([]);
    expect(res.skipped).toEqual(['wp_options']);
    const sql = readFileSync(out, 'utf-8');
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS=0;');
    expect(sql).toContain('SET FOREIGN_KEY_CHECKS=1;');
    expect(sql).not.toContain('INSERT INTO');
  });
});
