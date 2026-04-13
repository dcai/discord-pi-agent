export type TimeContextPromptOptions = {
	timeZone?: string;
	locale?: string;
	locationLabel?: string;
	now?: Date;
};

export function buildTimeContextPrompt(userMessage: string, options: TimeContextPromptOptions = {}): string {
	const timeZone = options.timeZone || "UTC";
	const locale = options.locale || "en-AU";
	const locationLabel = options.locationLabel || timeZone;
	const now = options.now || new Date();
	const localTime = new Intl.DateTimeFormat(locale, {
		timeZone,
		day: "numeric",
		month: "short",
		year: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(now);
	const trimmedMessage = userMessage.trim();

	return [`Local time: ${localTime}, ${locationLabel}`, "", "User message:", trimmedMessage].join("\n");
}
