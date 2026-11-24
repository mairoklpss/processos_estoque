// Redefinição segura de senha de usuário operacional (recuperação de acesso).
// A nova senha NUNCA passa pelo chat: chega por variável de ambiente (entrada mascarada no PowerShell).
// Reutiliza a lógica de negócio de services/auth (validarSenha + hash + revogação de sessões).
import { openRuntimeDatabase } from '../server/database-config.ts';
import { redefinirSenhaUsuario } from '../server/services/auth.ts';

async function main(): Promise<void> {
  const username = process.argv[2]?.trim().toLowerCase();
  const novaSenha = process.env.RESET_NOVA_SENHA;
  if (!username) throw new Error('Informe o username como argumento.');
  if (!novaSenha) throw new Error('Nova senha ausente no ambiente (RESET_NOVA_SENHA).');
  const { db } = await openRuntimeDatabase();
  try {
    const usuario = await db.get<{ id: number }>('SELECT id FROM usuarios WHERE LOWER(username) = ?', username);
    if (!usuario) throw new Error(`Usuário "${username}" não encontrado.`);
    await redefinirSenhaUsuario(db, Number(usuario.id), novaSenha);
    console.log(`reset-usuario: senha de "${username}" redefinida; sessões antigas revogadas.`);
  } finally {
    await db.close();
  }
}

main().catch((erro) => {
  console.error('reset-usuario: FALHOU:', erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
