/**
 * Stopword lists for word-frequency statistics.
 *
 * English and Russian are covered because Telegram exports in this app are
 * commonly one or the other. The list is intentionally conservative: it drops
 * grammatical filler, not vocabulary that says something about the
 * conversation. Chat-specific filler ("ok", "yeah", "лол") is included because
 * otherwise it swamps every result.
 */

const ENGLISH = `
a about above after again against all am an and any are aren't as at be because
been before being below between both but by can cannot could couldn't did
didn't do does doesn't doing don't down during each few for from further had
hadn't has hasn't have haven't having he her here hers herself him himself his
how i if in into is isn't it its itself let's me more most mustn't my myself no
nor not of off on once only or other ought our ours ourselves out over own same
shan't she should shouldn't so some such than that the their theirs them
themselves then there these they this those through to too under until up very
was wasn't we were weren't what when where which while who whom why with won't
would wouldn't you your yours yourself yourselves
im ive id ill youre hes shes theyre thats whats lets gonna wanna gotta
ok okay yeah yep yes no nope nah hey hi hello thanks thank sure just really
get got go going went come came know knew think thought see saw say said
want need make made take took like lik well good nice cool right yea
one two three too also still even much many lot bit way thing things
today tomorrow yesterday now then time day days
actually really probably definitely literally basically honestly anyway
maybe might must shall will ever never always every everything something anything
nothing someone anyone everyone quite pretty bad better best
u ur r n s t m ll ve re d
`;

const RUSSIAN = `
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы
по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг
ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя
ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без
будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой
совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех
никогда можно при наконец два об другой хоть после над больше тот через эти нас
про всего них какая много разве три эту моя впрочем хорошо свою этой перед
иногда лучше чуть том нельзя такой им более всегда конечно всю между
это так вообще просто очень ещё её мне тебе нас вам них
да нет ага угу ок окей спасибо привет пока блин ладно
буду будем будешь есть нету нужно надо хочу хочешь знаю знаешь думаю
можешь могу давай давайте типа короче кстати вроде как-то что-то кого-то
`;

function toSet(source: string): Set<string> {
  return new Set(
    source
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0),
  );
}

export const STOPWORDS: ReadonlySet<string> = new Set([
  ...toSet(ENGLISH),
  ...toSet(RUSSIAN),
]);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}
