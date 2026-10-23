import type { ReponsesTriage } from '@nudge/core';
import {
  CONFIANCES_AUTEUR,
  ETATS_DESTINATION,
  ETATS_RETOUR,
  GRAVITES,
  SOURCES,
  STATUTS_ENVOI,
  TYPES_RETOUR,
  type Auteur,
  type Contexte,
} from '@nudge/shared';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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

const horodatages = {
  creeLe: timestamp('cree_le', { withTimezone: true }).notNull().defaultNow(),
  modifieLe: timestamp('modifie_le', { withTimezone: true })
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
  ...horodatages,
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
    ...horodatages,
  },
  (t) => [index('retours_projet_cree_le_idx').on(t.projetId, t.creeLe)],
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
  reponsesBrutes: jsonb('reponses_brutes').$type<ReponsesTriage>(),
  ...horodatages,
});

export const destinations = pgTable('destinations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projetId: uuid('projet_id')
    .notNull()
    .references(() => projets.id, { onDelete: 'cascade' }),
  nom: text('nom').notNull(),
  /** Clé de l'adaptateur : `webhook`, `discord`, `linear`… */
  type: text('type').notNull(),
  /** Configuration non secrète de l'adaptateur. */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  etat: etatDestinationEnum('etat').notNull().default('active'),
  ...horodatages,
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
    ...horodatages,
  },
  // Idempotence : un Envoi par couple (Retour, Destination).
  (t) => [unique('envois_retour_destination_uniq').on(t.retourId, t.destinationId)],
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
