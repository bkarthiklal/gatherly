import type { CreateHoldInput, CreateOrderInput, CreatePromoCodeInput } from '@gatherly/types';
import type { RequestHandler } from 'express';
import { getAuth } from '../middleware/auth.js';
import { auditFromRequest } from '../services/audit.service.js';
import * as inventory from '../services/inventory.service.js';
import * as orders from '../services/order.service.js';
import * as promos from '../services/promo.service.js';

export const createHold: RequestHandler = async (req, res) => {
  res.status(201).json(await inventory.reserveSeats(getAuth(req), req.body as CreateHoldInput));
};

export const listHolds: RequestHandler = async (req, res) => {
  res.json({ items: await inventory.listMyHolds(getAuth(req)) });
};

export const releaseHold: RequestHandler = async (req, res) => {
  await inventory.releaseHold(getAuth(req), req.params.holdId as string);
  res.status(204).end();
};

export const quoteOrder: RequestHandler = async (req, res) => {
  res.json(await orders.quoteOrder(getAuth(req), req.body as CreateOrderInput));
};

export const createOrder: RequestHandler = async (req, res) => {
  res.status(201).json(await orders.createOrder(getAuth(req), req.body as CreateOrderInput));
};

export const listOrders: RequestHandler = async (req, res) => {
  res.json({ items: await orders.listMyOrders(getAuth(req)) });
};

export const getOrder: RequestHandler = async (req, res) => {
  res.json(await orders.getOrder(getAuth(req), req.params.orderId as string));
};

export const cancelOrder: RequestHandler = async (req, res) => {
  res.json(await orders.cancelOrder(getAuth(req), req.params.orderId as string));
};

export const createPromo: RequestHandler = async (req, res) => {
  const promo = await promos.createPromoCode(
    getAuth(req),
    req.params.eventId as string,
    req.body as CreatePromoCodeInput,
  );
  await auditFromRequest(req, 'promo.create', 'promo-code', promo.id, {
    code: promo.code,
    eventId: promo.eventId,
  });
  res.status(201).json(promo);
};

export const listPromos: RequestHandler = async (req, res) => {
  res.json({ items: await promos.listPromoCodes(getAuth(req), req.params.eventId as string) });
};

export const setPromoActive: RequestHandler = async (req, res) => {
  const active = (req.body as { active: boolean }).active;
  const promo = await promos.setPromoActive(
    getAuth(req),
    req.params.eventId as string,
    req.params.promoId as string,
    active,
  );
  await auditFromRequest(
    req,
    active ? 'promo.activate' : 'promo.deactivate',
    'promo-code',
    promo.id,
    {
      code: promo.code,
    },
  );
  res.json(promo);
};
