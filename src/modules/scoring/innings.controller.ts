import { Request, Response } from "express";
import * as InningsService from "./innings.service";

export const createInnings = async (
  req: Request,
  res: Response
) => {
  const innings =
    await InningsService.createInnings(
      req.body
    );

  res.status(201).json({
    success: true,
    data: innings,
  });
};

export const getInningsById = async (
  req: Request,
  res: Response
) => {
  const innings =
    await InningsService.getInningsById(
      req.params.id as string
    );

  res.status(200).json({
    success: true,
    data: innings,
  });
};

export const endInnings = async (
  req: Request,
  res: Response
) => {

  const innings =
    await InningsService.endInnings(
      req.params.inningsId as string
    );

  res.status(200).json({
    success: true,
    data: innings,
  });
};