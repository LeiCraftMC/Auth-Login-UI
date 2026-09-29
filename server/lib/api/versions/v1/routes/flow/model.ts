import { z } from "zod";

export namespace FlowModel.Complete {
	export const Body = z.object({
		sessionId: z.string().optional(),
		requestId: z.string().optional(),
		loginName: z.string().optional(),
		organization: z.string().optional(),
	});
	export type Body = z.infer<typeof Body>;
}
