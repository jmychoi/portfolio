from abc import ABC, abstractmethod
from pathlib import Path

from aggregator.config import PortfolioConfig
from aggregator.models import Holding


class InputParser(ABC):
    @abstractmethod
    def can_parse(self, path: Path) -> bool:
        raise NotImplementedError

    @abstractmethod
    def parse(self, path: Path, config: PortfolioConfig) -> list[Holding]:
        raise NotImplementedError
