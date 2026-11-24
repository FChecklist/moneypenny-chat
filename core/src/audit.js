// Every state change leaves one audit row: time, instance, ticket, action, who. No text and no person is written here.
export const audit = (ctx, instance, ticket, action, who) => ctx.store.audit({ at: ctx.now(), instance, ticket: ticket ?? null, action, who });
