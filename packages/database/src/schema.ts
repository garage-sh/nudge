import type { TriageAnswers } from '@nudge/core';
import {
  CONFIANCES_AUTEUR,
  ETATS_DESTINATION,
  ETATS_RETOUR,
  FOURNISSEURS_JUGE,
  GRAVITES,
  SOURCES,
  STATUTS_ENVOI,
  TYPES_RETOUR,
  type Auteur,
  type Contexte,
} from '@nudge/shared';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const typeRetourEnum = pgEnum('type_retour', TYPES_RETOUR);
export const graviteEnum = pgEnum('gravite', GRAVITES);
export const sourceEnum = pgEnum('source_retour', SOURCES);
export const etatRetourEnum = pgEnum('etat_retour', ETATS_RETOUR);
export const confianceAuteurEnum = pgEnum('confiance_auteur', CONFIANCES_AUTEUR);
export const etatDestinationEnum = pgEnum('etat_destination', ETATS_DESTINATION);
export const statutEnvoiEnum = pgEnum('statut_envoi', STATUTS_ENVOI);
export const fournisseurJugeEnum = pgEnum('fournisseur_juge', FOURNISSEURS_JUGE);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const projets = pgTable('projets', {
  id: uuid('id').primaryKey().defaultRandom(),
  nom: text('nom').notNull(),
  description: text('description'),
  clePublique: text('cle_publique').notNull().unique(),
  /** SHA-256 de la clé secrète : la clé elle-même n'est jamais stockée. */
  empreinteCleSecrete: text('empreinte_cle_secrete').notNull().unique(),
  /** Origines (`https://exemple.com`) d'où la clé publique est acceptée, normalisées. */
  originesAutorisees: text('origines_autorisees').array().notNull().default([]),
  ...timestamps,
});

export const membres = pgTable('membres', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** En minuscules : l'unicité ne dépend pas de la casse saisie. */
  email: text('email').notNull().unique(),
  /** Empreinte argon2id au format PHC ; le mot de passe n'est jamais stocké. */
  empreinteMotDePasse: text('empreinte_mot_de_passe').notNull(),
  ...timestamps,
});

/** Session du dashboard : le cookie porte le jeton, la base n'en garde que l'empreinte SHA-256. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    membreId: uuid('membre_id')
      .notNull()
      .references(() => membres.id, { onDelete: 'cascade' }),
    empreinteJeton: text('empreinte_jeton').notNull().unique(),
    expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_membre_idx').on(t.membreId)],
);

/** Lien d'invitation à usage unique ; seule l'empreinte SHA-256 du jeton est stockée. */
export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  empreinteJeton: text('empreinte_jeton').notNull().unique(),
  creeePar: uuid('creee_par').references(() => membres.id, { onDelete: 'set null' }),
  expireLe: timestamp('expire_le', { withTimezone: true }).notNull(),
  /** Renseigné quand l'invitation a servi : elle ne sert qu'une fois. */
  accepteeLe: timestamp('acceptee_le', { withTimezone: true }),
  membreId: uuid('membre_id').references(() => membres.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const retours = pgTable(
  'retours',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projetId: uuid('projet_id')
      .notNull()
      .references(() => projets.id, { onDelete: 'cascade' }),
    etat: etatRetourEnum('etat').notNull().default('recu'),
    source: sourceEnum('source').notNull(),
    /** Texte brut, stocké tel quel (nettoyé des caractères de contrôle). */
    texte: text('texte').notNull(),
    typeDeclare: typeRetourEnum('type_declare'),
    auteur: jsonb('auteur').$type<Auteur>(),
    confianceAuteur: confianceAuteurEnum('confiance_auteur'),
    contexte: jsonb('contexte').$type<Contexte>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index('retours_projet_created_at_idx').on(t.projetId, t.createdAt),
    // Boîte de réception : tous Projets confondus, du plus récent au plus ancien.
    index('retours_created_at_id_idx').on(t.createdAt, t.id),
  ],
);

export const verdicts = pgTable('verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  retourId: uuid('retour_id')
    .notNull()
    .unique()
    .references(() => retours.id, { onDelete: 'cascade' }),
  typeRetenu: typeRetourEnum('type_retenu').notNull(),
  gravite: graviteEnum('gravite'),
  indesirable: boolean('indesirable').notNull(),
  manipulation: boolean('manipulation').notNull(),
  incertain: boolean('incertain').notNull(),
  reponsesBrutes: jsonb('reponses_brutes').$type<TriageAnswers>(),
  ...timestamps,
});

export const destinations = pgTable('destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projetId: uuid('projet_id')
    .notNull()
    .references(() => projets.id, { onDelete: 'cascade' }),
  nom: text('nom').notNull(),
  /** Clé de l'adapter : `webhook`, `discord`, `linear`… */
  type: text('type').notNull(),
  /** Configuration non secrète de l'adapter. */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  etat: etatDestinationEnum('etat').notNull().default('active'),
  ...timestamps,
});

export const envois = pgTable(
  'envois',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    retourId: uuid('retour_id')
      .notNull()
      .references(() => retours.id, { onDelete: 'cascade' }),
    destinationId: uuid('destination_id')
      .notNull()
      .references(() => destinations.id, { onDelete: 'cascade' }),
    statut: statutEnvoiEnum('statut').notNull().default('en_attente'),
    lienExterne: text('lien_externe'),
    tentatives: integer('tentatives').notNull().default(0),
    derniereErreur: text('derniere_erreur'),
    ...timestamps,
  },
  // Idempotence : un Envoi par couple (Retour, Destination).
  (t) => [unique('envois_retour_destination_uniq').on(t.retourId, t.destinationId)],
);

/**
 * Paramètres de l'Instance (D6) : une seule ligne, `id = 1`, absente tant que rien
 * n'est configuré. Le Juge choisi ici prime sur les variables `NUDGE_JUDGE_*`. Les
 * paramètres d'Instance à venir (Destination d'alerte, durée de rétention)
 * s'ajoutent en colonnes de cette même ligne.
 */
export const parametresInstance = pgTable(
  'parametres_instance',
  {
    id: smallint('id').primaryKey().default(1),
    /** `null` : pas de Juge choisi pour l'Instance (repli sur l'environnement). */
    jugeFournisseur: fournisseurJugeEnum('juge_fournisseur'),
    jugeModele: text('juge_modele'),
    jugeUrlBase: text('juge_url_base'),
    /** Clé API du Juge, chiffrée par la clé d'Instance (`CONTEXTE_CLE_JUGE`). */
    jugeCleChiffree: text('juge_cle_chiffree'),
    ...timestamps,
  },
  (t) => [check('parametres_instance_ligne_unique', sql`${t.id} = 1`)],
);

export const projetsRelations = relations(projets, ({ many }) => ({
  retours: many(retours),
  destinations: many(destinations),
}));

export const retoursRelations = relations(retours, ({ one, many }) => ({
  projet: one(projets, { fields: [retours.projetId], references: [projets.id] }),
  verdict: one(verdicts),
  envois: many(envois),
}));

export const verdictsRelations = relations(verdicts, ({ one }) => ({
  retour: one(retours, { fields: [verdicts.retourId], references: [retours.id] }),
}));

export const destinationsRelations = relations(destinations, ({ one, many }) => ({
  projet: one(projets, { fields: [destinations.projetId], references: [projets.id] }),
  envois: many(envois),
}));

export const envoisRelations = relations(envois, ({ one }) => ({
  retour: one(retours, { fields: [envois.retourId], references: [retours.id] }),
  destination: one(destinations, {
    fields: [envois.destinationId],
    references: [destinations.id],
  }),
}));
