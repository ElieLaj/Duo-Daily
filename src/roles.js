import { PermissionsBitField } from 'discord.js';
import { config } from './config.js';

/**
 * Roles mentionnes lors d'une montee de rang.
 *
 * Resolus par nom autant que par identifiant : le nom est plus lisible dans le
 * .env et survit a une recreation du role.
 */

let roleIds = [];

export function promotionRoleIds() {
  return roleIds;
}

export async function loadPromotionRoles(client) {
  roleIds = [];
  if (!config.promotionRoles.length) return roleIds;

  try {
    const channel = await client.channels.fetch(config.channelId);
    const guild = channel?.guild;
    if (!guild) return roleIds;

    const roles = await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    const peutTousMentionner = channel.permissionsFor(me).has(PermissionsBitField.Flags.MentionEveryone);

    const muets = [];
    for (const demande of config.promotionRoles) {
      const cible = demande.toLowerCase();
      const role = roles.get(demande) ?? roles.find((r) => r.name.toLowerCase() === cible) ?? null;
      if (!role) {
        console.warn(`[roles] rôle "${demande}" introuvable, ignoré`);
        continue;
      }
      roleIds.push(role.id);
      if (!role.mentionable && !peutTousMentionner) muets.push(role.name);
    }

    // Un role non mentionnable n'envoie de notification que si l'auteur possede
    // la permission "Mentionner tous les roles". Sinon la mention s'affiche
    // mais ne previent personne : autant le dire clairement au demarrage.
    if (muets.length) {
      console.warn(
        `[roles] ${muets.map((n) => '@' + n).join(', ')} : mention affichée sans notification. ` +
          `Rends le rôle mentionnable (Paramètres du serveur > Rôles) ou donne au bot ` +
          `« Mentionner @everyone, @here et tous les rôles ».`,
      );
    }
    return roleIds;
  } catch (err) {
    console.warn(`[roles] résolution impossible (${err.message})`);
    return roleIds;
  }
}
