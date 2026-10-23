/** Marqueur d'un Verdict sur lequel le Juge a hésité : un Membre devrait le vérifier. */
export function BadgeIncertain() {
  return (
    <span className="badge badge-attention" title="Le Juge a hésité : à vérifier">
      Incertain
    </span>
  );
}
